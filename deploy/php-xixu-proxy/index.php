<?php
declare(strict_types=1);

// Upload this folder to a Hong Kong PHP host, then set:
// XI_XU_API_BASE_URL=https://your-domain.com/xixu-proxy
// XI_XU_PROXY_TOKEN=<same token as below>

$proxyToken = 'CHANGE_ME_TO_A_LONG_RANDOM_TOKEN';
$upstreamBase = 'https://api.xi-xu.me';
$maxBodyBytes = 25 * 1024 * 1024;
$timeoutSeconds = 1800;

function respond_json(int $status, array $data): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function header_value(string $name): string {
    $normalized = strtoupper(str_replace('-', '_', $name));
    if ($normalized === 'CONTENT_TYPE' && isset($_SERVER['CONTENT_TYPE'])) {
        return trim((string) $_SERVER['CONTENT_TYPE']);
    }
    if ($normalized === 'CONTENT_LENGTH' && isset($_SERVER['CONTENT_LENGTH'])) {
        return trim((string) $_SERVER['CONTENT_LENGTH']);
    }
    if ($normalized === 'AUTHORIZATION' && isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        return trim((string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
    }
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return isset($_SERVER[$key]) ? trim((string) $_SERVER[$key]) : '';
}

function starts_with(string $value, string $prefix): bool {
    return substr($value, 0, strlen($prefix)) === $prefix;
}

if ($proxyToken === 'CHANGE_ME_TO_A_LONG_RANDOM_TOKEN' || $proxyToken === '') {
    respond_json(500, ['error' => 'Proxy token is not configured']);
}

$incomingToken = header_value('X-XiXu-Proxy-Token');
if (!hash_equals($proxyToken, $incomingToken)) {
    respond_json(403, ['error' => 'Forbidden']);
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
if (!in_array($method, ['GET', 'POST'], true)) {
    respond_json(405, ['error' => 'Method not allowed']);
}

$uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '');
$basePath = rtrim(str_replace('\\', '/', dirname($scriptName)), '/');

if ($scriptName && starts_with($uriPath, $scriptName)) {
    $path = substr($uriPath, strlen($scriptName));
} elseif ($basePath && $basePath !== '.' && starts_with($uriPath, $basePath)) {
    $path = substr($uriPath, strlen($basePath));
} else {
    $path = $_GET['path'] ?? '/';
}

$path = '/' . ltrim((string) $path, '/');
if (!starts_with($path, '/v1/')) {
    respond_json(404, ['error' => 'Only /v1/* paths are allowed']);
}

$query = $_SERVER['QUERY_STRING'] ?? '';
if ($query !== '') {
    parse_str($query, $queryParams);
    unset($queryParams['path']);
    $query = http_build_query($queryParams);
}

$targetUrl = rtrim($upstreamBase, '/') . $path . ($query ? '?' . $query : '');
$body = file_get_contents('php://input');
if ($body === false) {
    respond_json(400, ['error' => 'Failed to read request body']);
}
if (strlen($body) > $maxBodyBytes) {
    respond_json(413, ['error' => 'Request body too large']);
}

$forwardHeaders = [];
foreach (['Authorization', 'Content-Type', 'Accept'] as $name) {
    $value = header_value($name);
    if ($value !== '') {
        $forwardHeaders[] = $name . ': ' . $value;
    }
}

$ch = curl_init($targetUrl);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $forwardHeaders,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 30,
    CURLOPT_TIMEOUT => $timeoutSeconds,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);

if ($method === 'POST') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$response = curl_exec($ch);
if ($response === false) {
    $error = curl_error($ch);
    $errno = curl_errno($ch);
    curl_close($ch);
    respond_json(502, ['error' => 'Upstream request failed', 'code' => $errno, 'message' => $error]);
}

$status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$responseHeaders = substr($response, 0, $headerSize);
$responseBody = substr($response, $headerSize);
curl_close($ch);

http_response_code($status ?: 502);
foreach (explode("\r\n", $responseHeaders) as $line) {
    if (stripos($line, 'content-type:') === 0) {
        header($line);
    }
}
header('X-Content-Type-Options: nosniff');
echo $responseBody;
