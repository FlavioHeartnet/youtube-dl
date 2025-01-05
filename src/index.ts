import { Command } from 'commander';
import ytdl from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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

// Execute the download
downloadVideo(url, options.output, options.quality);