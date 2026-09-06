// Live upstream probe. Explicit opt-in because each case may consume provider credits.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Agent, setGlobalDispatcher } = require('undici');
const { buildXiImageUrl, buildXiImageHeaders, getXiImageApiKey, parseXiXuImages } = require('../services/upstream-http');
const { saveXiXuImages } = require('../services/xi-image-compositor');
const { getLocalUploadPath, getImageDimensionsFromBuffer } = require('../utils/image-storage');
const { buildXiGeneratePrompt } = require('../services/prompt-service');

const cases = [
  { size: '1024x1024', quality: 'low' },
  { size: '1024x1024', quality: 'medium' },
  { size: '1024x1024', quality: 'high' },
  { size: '1024x1536', quality: 'medium' },
  { size: '2048x1152', quality: 'medium' },
  { size: '2048x2048', quality: 'high' }
];
const promptCases = [
  { size: '1024x1536', quality: 'medium' },
  { size: '2048x1152', quality: 'medium' },
  { size: '2048x2048', quality: 'high' }
];
const metadataKeys = ['size', 'quality', 'requested_size', 'requested_quality', 'usage', 'billing_mode', 'billing_note', 'image_parameter_mode', 'image_parameter_note', 'size_source', 'size_parameter_affects_output_guarantee', 'quality_parameter_affects_output_guarantee'];
function metadata(data) {
  return Object.fromEntries(metadataKeys.filter(key => data?.[key] !== undefined).map(key => [key, data[key]]));
}

async function main() {
  if (!process.argv.includes('--run')) {
    console.log('Run with --run for six billable parameter probes; add --prompt-size for three production-prompt probes, or --prompt-quality for one explicit high-quality prompt. Raw images and redacted results go to output/.');
    return;
  }
  const key = getXiImageApiKey();
  if (!key) throw new Error('Image provider key is not configured');
  process.env.XI_XU_NORMALIZE_OUTPUT_SIZE = 'false';
  const dispatcher = new Agent({ headersTimeout: 600000, bodyTimeout: 600000 });
  setGlobalDispatcher(dispatcher);
  const directory = path.join(__dirname, '..', 'output', `image-probe-${Date.now()}`);
  fs.mkdirSync(directory, { recursive: true });
  const promptQuality = process.argv.includes('--prompt-quality');
  const promptSize = process.argv.includes('--prompt-size') || promptQuality;
  const selectedCases = promptQuality ? [{ size: '2048x2048', quality: 'high' }] : promptSize ? promptCases : cases;
  const report = { date: new Date().toISOString(), model: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2', promptSize, promptQuality, cases: [] };
  console.log(`Results: ${directory}`);
  try {
    for (const [index, requested] of selectedCases.entries()) {
      const start = Date.now();
      const result = { requested };
      console.log(`Starting ${index + 1}/${selectedCases.length}: ${requested.size} ${requested.quality}`);
      try {
        let prompt = 'Studio product photograph of one red ceramic teapot on a pale grey background, fine embossed leaf pattern, soft side light, sharp small details, no text, no border.';
        if (promptQuality) prompt += ' Use the highest available image generation quality (quality=high), native 2048 by 2048 pixels. Resolve each tiny embossed leaf vein, ceramic glaze microtexture and subtle reflections with clean precise edges and natural material detail. Do not use a low-quality preview or a reduced-resolution draft.';
        const response = await fetch(buildXiImageUrl('/v1/images/generations'), {
          method: 'POST', signal: AbortSignal.timeout(600000),
          headers: buildXiImageHeaders({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
          // Same prompt across cases isolates the size/quality parameters.
          body: JSON.stringify({ model: report.model, prompt: promptSize ? buildXiGeneratePrompt(prompt, requested.size) : prompt, ...requested, n: 1, output_format: 'png' })
        });
        result.httpStatus = response.status;
        const data = await response.json();
        result.metadata = metadata(data);
        result.imageMetadata = (data.data || []).map(metadata);
        if (!response.ok) {
          // Do not log arbitrary provider errors: they can contain credentials or signed URLs.
          result.error = `HTTP ${response.status}`;
        } else {
          const urls = parseXiXuImages(data);
          if (!urls.length) throw new Error('No images in response');
          const localUrls = await saveXiXuImages(urls, `probe_${index + 1}`);
          result.images = localUrls.map((url, imageIndex) => {
            const source = getLocalUploadPath(url);
            const buffer = fs.readFileSync(source);
            const filename = `${index + 1}-${requested.size}-${requested.quality}-${imageIndex + 1}${path.extname(source)}`;
            fs.copyFileSync(source, path.join(directory, filename));
            fs.unlinkSync(source);
            return { file: filename, ...getImageDimensionsFromBuffer(buffer), bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
          });
        }
      } catch (error) {
        result.error = error.name || 'Error';
      }
      result.seconds = Math.round((Date.now() - start) / 1000);
      report.cases.push(result);
      fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(result));
    }
  } finally {
    await dispatcher.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
