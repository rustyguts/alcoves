import { describe, it, expect } from 'vitest';
import { ICONS } from '$lib/utils/icons';
import {
	getMimeIcon,
	getMimeTypeFromFilename,
	formatFileSize,
	formatDate
} from '$lib/utils/mime-icons';

describe('getMimeIcon', () => {
	it('returns folder icon for inode/directory', () => {
		expect(getMimeIcon('inode/directory')).toBe(ICONS.folder);
	});

	it('returns file icon for PDF mime type', () => {
		expect(getMimeIcon('application/pdf')).toBe(ICONS.file);
	});

	it('returns archive icon for all ZIP-family mime types', () => {
		expect(getMimeIcon('application/zip')).toBe(ICONS.zip);
		expect(getMimeIcon('application/x-zip-compressed')).toBe(ICONS.zip);
		expect(getMimeIcon('application/gzip')).toBe(ICONS.zip);
		expect(getMimeIcon('application/x-tar')).toBe(ICONS.zip);
		expect(getMimeIcon('application/x-rar-compressed')).toBe(ICONS.zip);
	});

	it('returns file icon for JSON mime type', () => {
		expect(getMimeIcon('application/json')).toBe(ICONS.file);
	});

	it('returns file icon for Office word/excel documents', () => {
		expect(
			getMimeIcon('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
		).toBe(ICONS.file);
		expect(getMimeIcon('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(
			ICONS.file
		);
		expect(getMimeIcon('application/msword')).toBe(ICONS.file);
		expect(getMimeIcon('application/vnd.ms-excel')).toBe(ICONS.file);
	});

	it('returns presentation icon for PowerPoint documents', () => {
		expect(
			getMimeIcon('application/vnd.openxmlformats-officedocument.presentationml.presentation')
		).toBe(ICONS.presentation);
		expect(getMimeIcon('application/vnd.ms-powerpoint')).toBe(ICONS.presentation);
	});

	it('returns image icon for image/* mime types', () => {
		expect(getMimeIcon('image/jpeg')).toBe(ICONS.image);
		expect(getMimeIcon('image/png')).toBe(ICONS.image);
		expect(getMimeIcon('image/gif')).toBe(ICONS.image);
		expect(getMimeIcon('image/svg+xml')).toBe(ICONS.image);
	});

	it('returns video icon for video/* mime types', () => {
		expect(getMimeIcon('video/mp4')).toBe(ICONS.video);
		expect(getMimeIcon('video/webm')).toBe(ICONS.video);
		expect(getMimeIcon('video/quicktime')).toBe(ICONS.video);
	});

	it('returns music icon for audio/* mime types', () => {
		expect(getMimeIcon('audio/mpeg')).toBe(ICONS.music);
		expect(getMimeIcon('audio/wav')).toBe(ICONS.music);
		expect(getMimeIcon('audio/ogg')).toBe(ICONS.music);
	});

	it('returns file icon for text/* mime types', () => {
		expect(getMimeIcon('text/plain')).toBe(ICONS.file);
		expect(getMimeIcon('text/html')).toBe(ICONS.file);
		expect(getMimeIcon('text/css')).toBe(ICONS.file);
	});

	it('returns default file icon for unknown mime types', () => {
		expect(getMimeIcon('application/unknown')).toBe(ICONS.file);
		expect(getMimeIcon('unknown/type')).toBe(ICONS.file);
		expect(getMimeIcon('')).toBe(ICONS.file);
	});

	it('prefers exact map matches over prefix matches', () => {
		// exact-map entries (e.g. text/* powerpoint) still hit the exact branch first
		expect(getMimeIcon('application/vnd.ms-powerpoint')).toBe(ICONS.presentation);
	});
});

describe('getMimeTypeFromFilename', () => {
	it('returns correct mime type for common file extensions', () => {
		expect(getMimeTypeFromFilename('document.pdf')).toBe('application/pdf');
		expect(getMimeTypeFromFilename('doc.doc')).toBe('application/msword');
		expect(getMimeTypeFromFilename('doc.docx')).toBe(
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		);
		expect(getMimeTypeFromFilename('sheet.xls')).toBe('application/vnd.ms-excel');
		expect(getMimeTypeFromFilename('sheet.xlsx')).toBe(
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		);
		expect(getMimeTypeFromFilename('slides.ppt')).toBe('application/vnd.ms-powerpoint');
		expect(getMimeTypeFromFilename('slides.pptx')).toBe(
			'application/vnd.openxmlformats-officedocument.presentationml.presentation'
		);
		expect(getMimeTypeFromFilename('image.jpg')).toBe('image/jpeg');
		expect(getMimeTypeFromFilename('image.jpeg')).toBe('image/jpeg');
		expect(getMimeTypeFromFilename('image.png')).toBe('image/png');
		expect(getMimeTypeFromFilename('image.gif')).toBe('image/gif');
		expect(getMimeTypeFromFilename('icon.svg')).toBe('image/svg+xml');
		expect(getMimeTypeFromFilename('image.webp')).toBe('image/webp');
		expect(getMimeTypeFromFilename('video.mp4')).toBe('video/mp4');
		expect(getMimeTypeFromFilename('video.webm')).toBe('video/webm');
		expect(getMimeTypeFromFilename('video.mov')).toBe('video/quicktime');
		expect(getMimeTypeFromFilename('audio.mp3')).toBe('audio/mpeg');
		expect(getMimeTypeFromFilename('audio.wav')).toBe('audio/wav');
		expect(getMimeTypeFromFilename('audio.ogg')).toBe('audio/ogg');
		expect(getMimeTypeFromFilename('archive.zip')).toBe('application/zip');
		expect(getMimeTypeFromFilename('archive.tar')).toBe('application/x-tar');
		expect(getMimeTypeFromFilename('archive.gz')).toBe('application/gzip');
		expect(getMimeTypeFromFilename('archive.rar')).toBe('application/x-rar-compressed');
		expect(getMimeTypeFromFilename('data.json')).toBe('application/json');
		expect(getMimeTypeFromFilename('text.txt')).toBe('text/plain');
		expect(getMimeTypeFromFilename('readme.md')).toBe('text/markdown');
		expect(getMimeTypeFromFilename('page.html')).toBe('text/html');
		expect(getMimeTypeFromFilename('style.css')).toBe('text/css');
		expect(getMimeTypeFromFilename('script.js')).toBe('text/javascript');
		expect(getMimeTypeFromFilename('module.ts')).toBe('text/typescript');
		expect(getMimeTypeFromFilename('config.yaml')).toBe('text/yaml');
		expect(getMimeTypeFromFilename('config.yml')).toBe('text/yaml');
		expect(getMimeTypeFromFilename('query.sql')).toBe('text/plain');
		expect(getMimeTypeFromFilename('table.csv')).toBe('text/csv');
	});

	it('handles case-insensitive extensions', () => {
		expect(getMimeTypeFromFilename('file.PDF')).toBe('application/pdf');
		expect(getMimeTypeFromFilename('file.PNG')).toBe('image/png');
		expect(getMimeTypeFromFilename('file.MP4')).toBe('video/mp4');
	});

	it('returns default mime type for unknown extensions', () => {
		expect(getMimeTypeFromFilename('file.xyz')).toBe('application/octet-stream');
		expect(getMimeTypeFromFilename('file.unknown')).toBe('application/octet-stream');
	});

	it('handles files without extensions', () => {
		expect(getMimeTypeFromFilename('README')).toBe('application/octet-stream');
		expect(getMimeTypeFromFilename('Makefile')).toBe('application/octet-stream');
	});

	it('handles an empty filename', () => {
		expect(getMimeTypeFromFilename('')).toBe('application/octet-stream');
	});

	it('handles files with multiple dots', () => {
		expect(getMimeTypeFromFilename('my.file.name.pdf')).toBe('application/pdf');
		expect(getMimeTypeFromFilename('archive.tar.gz')).toBe('application/gzip');
	});
});

describe('formatFileSize', () => {
	it('formats zero bytes', () => {
		expect(formatFileSize(0)).toBe('0 B');
	});

	it('formats bytes', () => {
		expect(formatFileSize(500)).toBe('500 B');
		expect(formatFileSize(1023)).toBe('1023 B');
	});

	it('formats kilobytes', () => {
		expect(formatFileSize(1024)).toBe('1 KB');
		expect(formatFileSize(1536)).toBe('1.5 KB');
		expect(formatFileSize(10240)).toBe('10 KB');
	});

	it('formats megabytes', () => {
		expect(formatFileSize(1048576)).toBe('1 MB');
		expect(formatFileSize(1572864)).toBe('1.5 MB');
		expect(formatFileSize(10485760)).toBe('10 MB');
	});

	it('formats gigabytes', () => {
		expect(formatFileSize(1073741824)).toBe('1 GB');
		expect(formatFileSize(1610612736)).toBe('1.5 GB');
	});

	it('formats terabytes', () => {
		expect(formatFileSize(1099511627776)).toBe('1 TB');
		expect(formatFileSize(1649267441664)).toBe('1.5 TB');
	});
});

describe('formatDate', () => {
	it('formats date strings', () => {
		const result = formatDate('2024-01-15T10:30:00Z');
		expect(result).toMatch(/Jan 1[45], 2024/); // Account for timezone differences
	});

	it('formats ISO date strings', () => {
		const result = formatDate('2024-12-25T00:00:00Z');
		expect(result).toMatch(/Dec 2[45], 2024/); // Account for timezone differences
	});

	it('handles different date formats', () => {
		const result = formatDate('2024-06-01');
		expect(result).toContain('2024');
		expect(result).toMatch(/May 31|Jun 1/); // Account for timezone differences
	});
});
