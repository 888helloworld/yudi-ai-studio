<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_WARNING);
ini_set('display_errors', '0');

// Upload this folder to a Hong Kong PHP host, then set:
// XI_XU_API_BASE_URL=https://your-domain.com/xixu-proxy
// XI_XU_PROXY_TOKEN=<same token as below>

$proxyToken = 'CHANGE_ME_TO_A_LONG_RANDOM_TOKEN';
$upstreamBase = 'https://api.xi-xu.me';
$maxBodyBytes = 25 * 1024 * 1024;
$timeoutSeconds = 1800;

function respond_json($status, $data) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (!function_exists('hash_equals')) {
    function hash_equals($known, $user) {
        if (!is_string($known) || !is_string($user)) return false;
        if (strlen($known) !== strlen($user)) return false;
        $result = 0;
        for ($i = 0; $i < strlen($known); $i += 1) {
            $result |= ord($known[$i]) ^ ord($user[$i]);
        }
        return $result === 0;
    }
}

function header_value($name) {
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

function starts_with($value, $prefix) {
    return substr($value, 0, strlen($prefix)) === $prefix;
}

if ($proxyToken === '' || starts_with($proxyToken, 'CHANGE_ME_')) {
    respond_json(500, array('error' => 'Proxy token is not configured'));
}

$incomingToken = header_value('X-XiXu-Proxy-Token');
if (!hash_equals($proxyToken, $incomingToken)) {
    respond_json(403, array('error' => 'Forbidden'));
}

$method = strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET');
if (!in_array($method, array('GET', 'POST'), true)) {
    respond_json(405, array('error' => 'Method not allowed'));
}

$requestUri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
$uriPath = parse_url($requestUri, PHP_URL_PATH);
if (!$uriPath) $uriPath = '/';
$scriptName = str_replace('\\', '/', isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : '');
$basePath = rtrim(str_replace('\\', '/', dirname($scriptName)), '/');

if (isset($_GET['path'])) {
    $path = $_GET['path'];
} elseif ($scriptName && starts_with($uriPath, $scriptName)) {
    $path = substr($uriPath, strlen($scriptName));
} elseif ($basePath && $basePath !== '.' && starts_with($uriPath, $basePath)) {
    $path = substr($uriPath, strlen($basePath));
} else {
    $path = '/';
}

$path = '/' . ltrim((string) $path, '/');
if (!starts_with($path, '/v1/')) {
    respond_json(404, array('error' => 'Only /v1/* paths are allowed'));
}

$query = isset($_SERVER['QUERY_STRING']) ? $_SERVER['QUERY_STRING'] : '';
if ($query !== '') {
    parse_str($query, $queryParams);
    unset($queryParams['path']);
    $query = http_build_query($queryParams);
}

$targetUrl = rtrim($upstreamBase, '/') . $path . ($query ? '?' . $query : '');
$body = file_get_contents('php://input');
if ($body === false) {
    respond_json(400, array('error' => 'Failed to read request body'));
}
if (strlen($body) > $maxBodyBytes) {
    respond_json(413, array('error' => 'Request body too large'));
}

$forwardHeaders = array();
foreach (array('Authorization', 'Content-Type', 'Accept') as $name) {
    $value = header_value($name);
    if ($value !== '') {
        $forwardHeaders[] = $name . ': ' . $value;
    }
}

$ch = curl_init($targetUrl);
curl_setopt_array($ch, array(
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $forwardHeaders,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 30,
    CURLOPT_TIMEOUT => $timeoutSeconds,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
));

if ($method === 'POST') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$response = curl_exec($ch);
if ($response === false) {
    $error = curl_error($ch);
    $errno = curl_errno($ch);
    curl_close($ch);
    respond_json(502, array('error' => 'Upstream request failed', 'code' => $errno, 'message' => $error));
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
