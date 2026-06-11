// Package ffmpeg provides shared helpers for driving ffmpeg's progress
// protocol. It centralizes the "-progress pipe:2 -nostats" stderr parsing loop
// that multiple media pipelines (video proxy, moment export) use to report
// transcode progress, so each caller only has to build its own ffmpeg args and
// handle its own post-run tail.
package ffmpeg

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"math"
	"os/exec"
	"strconv"
	"strings"
)

// RunWithProgress runs ffmpeg (bin, typically "ffmpeg") with args that MUST
// already include "-progress pipe:2 -nostats". It discards stdout, scans
// stderr for the progress protocol, and invokes onProgress(percent, etaSeconds)
// whenever the computed percent or ETA changes. durationSeconds drives the
// percent/ETA math; when it is <= 0 or onProgress is nil, progress reporting
// is skipped but ffmpeg still runs to completion. It returns when ffmpeg exits;
// a non-zero exit is returned as an error. It does NOT emit a final 100% tick
// or stat the output — those remain the caller's responsibility.
func RunWithProgress(
	ctx context.Context,
	bin string,
	args []string,
	durationSeconds float64,
	onProgress func(progress int, etaSeconds *int),
) error {
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Stdout = io.Discard
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create ffmpeg stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	lastProgress := -1
	lastETA := -1
	currentOutTimeSeconds := 0.0
	currentSpeed := 0.0

	scanner := bufio.NewScanner(stderrPipe)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := parts[0]
		value := parts[1]

		switch key {
		case "out_time":
			if parsed, parseErr := parseOutTime(value); parseErr == nil {
				currentOutTimeSeconds = parsed
			}
		case "speed":
			if parsed, parseErr := parseSpeed(value); parseErr == nil {
				currentSpeed = parsed
			}
		case "progress":
			if durationSeconds <= 0 || onProgress == nil {
				continue
			}

			percent := int(math.Round((currentOutTimeSeconds / durationSeconds) * 100))
			if percent < 0 {
				percent = 0
			}
			if percent > 100 {
				percent = 100
			}

			var etaSeconds *int
			etaVal := -1
			if currentSpeed > 0 && currentOutTimeSeconds < durationSeconds {
				remaining := durationSeconds - currentOutTimeSeconds
				eta := int(math.Ceil(remaining / currentSpeed))
				if eta < 0 {
					eta = 0
				}
				etaSeconds = &eta
				etaVal = eta
			}

			if percent != lastProgress || etaVal != lastETA {
				onProgress(percent, etaSeconds)
				lastProgress = percent
				lastETA = etaVal
			}
		}
	}

	if scanErr := scanner.Err(); scanErr != nil {
		log.Printf("ffmpeg: progress parse warning: %v", scanErr)
	}

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("ffmpeg exited with error: %w", err)
	}

	return nil
}

func parseOutTime(value string) (float64, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 3 {
		return 0, fmt.Errorf("invalid out_time: %q", value)
	}

	hours, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return 0, err
	}
	minutes, err := strconv.ParseFloat(parts[1], 64)
	if err != nil {
		return 0, err
	}
	seconds, err := strconv.ParseFloat(parts[2], 64)
	if err != nil {
		return 0, err
	}

	return (hours * 3600) + (minutes * 60) + seconds, nil
}

func parseSpeed(value string) (float64, error) {
	trimmed := strings.TrimSuffix(strings.TrimSpace(value), "x")
	if trimmed == "" {
		return 0, fmt.Errorf("empty speed")
	}

	speed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0, err
	}
	if speed <= 0 {
		return 0, fmt.Errorf("invalid speed: %f", speed)
	}

	return speed, nil
}
