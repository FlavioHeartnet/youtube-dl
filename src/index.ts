import { Command } from 'commander';
import ytdl from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execFile } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('yt-dl')
  .description('YouTube video downloader CLI')
  .version('1.0.0')
  .argument('<url>', 'YouTube video URL')
  .option('-o, --output <directory>', 'Output directory', './downloads')
  .option('-q, --quality <quality>', 'Video quality (highest/lowest)', 'highest')
  .option('-a, --audio', 'Download audio only as MP3', false)
  .parse(process.argv);

const options = program.opts();
const url = program.args[0];

async function downloadVideo(videoUrl: string, outputDir: string, quality: string) {
  const spinner = ora('Getting video information...').start();
  
  try {
    // Validate URL
    if (!ytdl.validateURL(videoUrl)) {
      spinner.fail('Invalid YouTube URL');
      process.exit(1);
    }

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get video info with additional options
    const info = await ytdl.getInfo(videoUrl, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        }
      }
    });

    const videoTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '_');
    const outputPath = path.join(process.cwd(), outputDir, `${videoTitle}.mp4`);

    spinner.text = 'Starting download...';

    // Get the best format based on quality preference
    const formats = ytdl.filterFormats(info.formats, 'videoandaudio');
    const format = quality === 'highest' 
      ? formats.reduce((prev, curr) => (prev.qualityLabel > curr.qualityLabel ? prev : curr))
      : formats.reduce((prev, curr) => (prev.qualityLabel < curr.qualityLabel ? prev : curr));

    if (!format) {
      throw new Error('No suitable format found');
    }

    const stream = ytdl.downloadFromInfo(info, {
      format: format
    });

    stream.pipe(fs.createWriteStream(outputPath));

    // Handle download progress
    let lastPercentage = 0;
    stream.on('progress', (_, downloaded, total) => {
      const percentage = Math.floor((downloaded / total) * 100);
      if (percentage > lastPercentage) {
        spinner.text = `Downloading... ${percentage}%`;
        lastPercentage = percentage;
      }
    });

    // Handle download completion
    stream.on('end', () => {
      spinner.succeed(chalk.green(`Download completed! Saved to: ${outputPath}`));
      process.exit(0);
    });

    // Handle errors
    stream.on('error', (error) => {
      spinner.fail(chalk.red(`Download failed: ${error.message}`));
      console.error(chalk.red('Full error:', error));
      process.exit(1);
    });

  } catch (error) {
    spinner.fail(chalk.red('Download failed'));
    if (error instanceof Error) {
      console.error(chalk.red(`Error details: ${error.message}`));
      console.error(chalk.red('Full error:', error));
    }
    process.exit(1);
  }
}

async function downloadAudio(videoUrl: string, outputDir: string) {
  const spinner = ora('Getting audio information...').start();
  
  try {
    // Validate URL
    if (!ytdl.validateURL(videoUrl)) {
      spinner.fail('Invalid YouTube URL');
      process.exit(1);
    }

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Try using yt-dlp first (more reliable), fallback to ytdl-core
    const hasYtDlp = await checkYtDlpInstalled();
    
    if (hasYtDlp) {
      await downloadAudioWithYtDlp(videoUrl, outputDir, spinner);
    } else {
      spinner.warn(chalk.yellow('yt-dlp not found. Attempting with ytdl-core (may fail due to player script updates)...'));
      await downloadAudioWithYtdlCore(videoUrl, outputDir, spinner);
    }

  } catch (error) {
    spinner.fail(chalk.red('Audio download failed'));
    if (error instanceof Error) {
      console.error(chalk.red(`Error details: ${error.message}`));
      console.error(chalk.red('Full error:', error));
    }
    process.exit(1);
  }
}

async function checkYtDlpInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('yt-dlp', ['--version'], (error) => {
      resolve(!error);
    });
  });
}

async function downloadAudioWithYtDlp(videoUrl: string, outputDir: string, spinner: any) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');
    
    const child = execFile('yt-dlp', [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '192',
      '-o', outputTemplate,
      videoUrl
    ], (error, stdout, stderr) => {
      if (error) {
        const errorMessage = stderr?.toString() || error.message;
        if (errorMessage.includes('ffmpeg')) {
          reject(new Error('ffmpeg is not installed. Please install ffmpeg:\n' +
            '  macOS: brew install ffmpeg\n' +
            '  Ubuntu/Debian: sudo apt-get install ffmpeg\n' +
            '  Windows: choco install ffmpeg'));
        } else {
          reject(new Error(`yt-dlp error: ${errorMessage}`));
        }
      } else {
        spinner.succeed(chalk.green(`Audio download completed!`));
        process.exit(0);
      }
    });

    child.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      if (message.includes('%')) {
        const match = message.match(/(\d+)%/);
        if (match) {
          spinner.text = `Downloading audio... ${match[1]}%`;
        }
      }
    });
  });
}

async function downloadAudioWithYtdlCore(videoUrl: string, outputDir: string, spinner: any) {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        // Get video info with additional options
        const info = await ytdl.getInfo(videoUrl, {
          requestOptions: {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            }
          }
        });

        const videoTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '_');
        const outputPath = path.join(process.cwd(), outputDir, `${videoTitle}.mp3`);

        spinner.text = 'Starting audio download...';

        // Get the best audio format
        const formats = ytdl.filterFormats(info.formats, 'audioonly');
        const format = formats.reduce((prev, curr) => ((prev.bitrate ?? 0) > (curr.bitrate ?? 0) ? prev : curr));

        if (!format) {
          throw new Error('No suitable audio format found');
        }

        const stream = ytdl.downloadFromInfo(info, {
          format: format
        });

        stream.pipe(fs.createWriteStream(outputPath));

        // Handle download progress
        let lastPercentage = 0;
        stream.on('progress', (_, downloaded, total) => {
          const percentage = Math.floor((downloaded / total) * 100);
          if (percentage > lastPercentage) {
            spinner.text = `Downloading audio... ${percentage}%`;
            lastPercentage = percentage;
          }
        });

        // Handle download completion
        stream.on('end', () => {
          spinner.succeed(chalk.green(`Audio download completed! Saved to: ${outputPath}`));
          process.exit(0);
        });

        // Handle errors
        stream.on('error', (error) => {
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    })();
  });
}

// Execute the download
if (options.audio) {
  downloadAudio(url, options.output);
} else {
  downloadVideo(url, options.output, options.quality);
}