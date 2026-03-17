<?php
$output = "";
$error = "";

$uploadDir = __DIR__ . "/uploads/";
$webUploadDir = "uploads/";

if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0777, true);
}

function safeFileName($name) {
    $name = preg_replace('/[^a-zA-Z0-9._-]/', '_', $name);
    return $name ?: 'audio.opus';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['audio'])) {
    if ($_FILES['audio']['error'] !== UPLOAD_ERR_OK) {
        $error = "Upload failed.";
    } else {
        $originalName = safeFileName($_FILES['audio']['name']);
        $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));

        $allowed = ['opus', 'ogg', 'webm'];
        if (!in_array($ext, $allowed, true)) {
            $error = "Only OPUS, OGG, and WEBM files are allowed.";
        } else {
            $baseName = pathinfo($originalName, PATHINFO_FILENAME);
            $unique = $baseName . "_" . time();

            $inputFile = $uploadDir . $unique . "." . $ext;
            $outputFile = $uploadDir . $unique . ".mp3";

            if (move_uploaded_file($_FILES['audio']['tmp_name'], $inputFile)) {
                $ffmpeg = "ffmpeg";
                $cmd = $ffmpeg
                    . " -y -i " . escapeshellarg($inputFile)
                    . " -b:a 192k "
                    . escapeshellarg($outputFile)
                    . " 2>&1";

                exec($cmd, $cmdOutput, $returnCode);

                if ($returnCode === 0 && file_exists($outputFile)) {
                    $output = $webUploadDir . basename($outputFile);
                } else {
                    $error = "Conversion failed. Check if FFmpeg is installed on your server.";
                }
            } else {
                $error = "Could not save uploaded file.";
            }
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OPUS to MP3 Converter</title>
    <link rel="stylesheet" href="assets/style.css">
</head>
<body>
    <div class="wrap">
        <div class="card">
            <h1>OPUS → MP3 Converter</h1>
            <p>Upload an audio file and convert it to MP3.</p>

            <form method="post" enctype="multipart/form-data">
                <input type="file" name="audio" accept=".opus,.ogg,.webm,audio/ogg,audio/webm" required>
                <button type="submit">Convert to MP3</button>
            </form>

            <?php if ($error): ?>
                <div class="msg error"><?php echo htmlspecialchars($error); ?></div>
            <?php endif; ?>

            <?php if ($output): ?>
                <div class="msg success">
                    Conversion complete:
                    <br><br>
                    <a href="<?php echo htmlspecialchars($output); ?>" download>Download MP3</a>
                </div>
            <?php endif; ?>
        </div>
    </div>
</body>
</html>
