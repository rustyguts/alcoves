package objectdetection

import (
	"fmt"
	"math"
	"sort"

	"github.com/davidbyttow/govips/v2/vips"
	ort "github.com/yalue/onnxruntime_go"
)

const (
	inputSize  = 640
	numClasses = 80
)

// Detection represents a single detected object.
type Detection struct {
	Label      string
	ClassID    int
	Confidence float64
	BoxX       float64
	BoxY       float64
	BoxWidth   float64
	BoxHeight  float64
}

// DetectObjects runs YOLOv8 inference on raw image data and returns detections.
func DetectObjects(session *ort.DynamicAdvancedSession, imageData []byte, config *ObjectConfig) ([]Detection, int, int, error) {
	img, err := vips.NewImageFromBuffer(imageData)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("failed to load image: %w", err)
	}
	defer img.Close()

	if err := img.AutoRotate(); err != nil {
		return nil, 0, 0, fmt.Errorf("failed to auto-rotate image: %w", err)
	}

	origW := img.Width()
	origH := img.Height()

	// Preprocess: resize with letterboxing to 640x640
	inputTensor, scale, padX, padY, err := preprocessForDetection(img)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("preprocessing failed: %w", err)
	}

	// Create input tensor
	inputShape := ort.NewShape(1, 3, inputSize, inputSize)
	input, err := ort.NewTensor(inputShape, inputTensor)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("failed to create input tensor: %w", err)
	}
	defer input.Destroy()

	// Run inference
	outputs := make([]ort.Value, 1)
	if err := session.Run([]ort.Value{input}, outputs); err != nil {
		return nil, 0, 0, fmt.Errorf("inference failed: %w", err)
	}
	defer func() {
		for _, o := range outputs {
			if o != nil {
				o.Destroy()
			}
		}
	}()

	// YOLOv8 output shape: [1, 84, 8400]
	// 84 = 4 (bbox: cx, cy, w, h) + 80 (class scores)
	// 8400 = total number of detection candidates
	outputTensor := outputs[0].(*ort.Tensor[float32])
	rawData := outputTensor.GetData()

	detections := decodeYOLOv8Output(rawData, scale, padX, padY, config)

	return detections, origW, origH, nil
}

// preprocessForDetection resizes the image to 640x640 with letterboxing (padding),
// normalizes to 0..1, and returns the CHW float32 tensor plus scaling/padding info.
func preprocessForDetection(img *vips.ImageRef) ([]float32, float64, float64, float64, error) {
	w := img.Width()
	h := img.Height()

	// Scale to fit within 640x640 preserving aspect ratio
	scale := math.Min(float64(inputSize)/float64(w), float64(inputSize)/float64(h))
	newW := int(math.Round(float64(w) * scale))
	newH := int(math.Round(float64(h) * scale))

	if err := img.Resize(scale, vips.KernelLinear); err != nil {
		return nil, 0, 0, 0, err
	}

	// Compute padding for center-aligned letterbox
	padX := float64(inputSize-newW) / 2.0
	padY := float64(inputSize-newH) / 2.0
	padLeft := int(math.Round(padX))
	padTop := int(math.Round(padY))

	// Embed in 640x640 canvas with gray (114, 114, 114) padding — standard YOLO letterbox color
	if newW < inputSize || newH < inputSize {
		if err := img.Embed(padLeft, padTop, inputSize, inputSize, vips.ExtendBackground); err != nil {
			// Fallback to black padding if background extend fails
			if err2 := img.Embed(padLeft, padTop, inputSize, inputSize, vips.ExtendBlack); err2 != nil {
				return nil, 0, 0, 0, err2
			}
		}
	}

	// Get raw RGB pixel data
	rawBytes, err := exportRawRGB(img)
	if err != nil {
		return nil, 0, 0, 0, err
	}

	// Convert to CHW float32 normalized to [0, 1]
	pixels := inputSize * inputSize
	tensor := make([]float32, 3*pixels)
	for i := 0; i < pixels; i++ {
		tensor[i] = float32(rawBytes[i*3]) / 255.0            // R
		tensor[pixels+i] = float32(rawBytes[i*3+1]) / 255.0   // G
		tensor[2*pixels+i] = float32(rawBytes[i*3+2]) / 255.0 // B
	}

	return tensor, scale, padX, padY, nil
}

// exportRawRGB extracts raw RGB pixel data from a vips image.
func exportRawRGB(img *vips.ImageRef) ([]byte, error) {
	// Ensure 3-band sRGB
	if err := img.ToColorSpace(vips.InterpretationSRGB); err != nil {
		return nil, err
	}
	if img.Bands() > 3 {
		if err := img.Flatten(&vips.Color{R: 114, G: 114, B: 114}); err != nil {
			return nil, err
		}
	}

	// Export via PNG round-trip for reliable raw bytes
	params := vips.NewDefaultExportParams()
	params.Format = vips.ImageTypePNG
	pngData, _, err := img.Export(params)
	if err != nil {
		return nil, err
	}

	memImg, err := vips.NewImageFromBuffer(pngData)
	if err != nil {
		return nil, err
	}
	defer memImg.Close()

	w := memImg.Width()
	h := memImg.Height()
	rawBytes, err := memImg.ToBytes()
	if err != nil {
		return nil, err
	}

	bands := memImg.Bands()
	result := make([]byte, w*h*3)
	for i := 0; i < w*h; i++ {
		result[i*3] = rawBytes[i*bands]
		result[i*3+1] = rawBytes[i*bands+1]
		result[i*3+2] = rawBytes[i*bands+2]
	}

	return result, nil
}

// decodeYOLOv8Output parses the raw [1, 84, 8400] output tensor into detections.
// YOLOv8 output is transposed compared to YOLOv5: each of 8400 candidates has
// 84 values stored column-major (84 rows x 8400 cols in the raw layout).
func decodeYOLOv8Output(data []float32, scale, padX, padY float64, config *ObjectConfig) []Detection {
	// Output layout: [1, 84, 8400] flattened
	// Row 0-3: cx, cy, w, h
	// Row 4-83: class scores for 80 COCO classes
	const numCandidates = 8400
	const rowLen = numCandidates

	// Safety check
	if len(data) < 84*numCandidates {
		return nil
	}

	var detections []Detection

	for i := 0; i < numCandidates; i++ {
		// Find the class with the highest score
		bestClass := -1
		bestScore := float64(0)
		for c := 0; c < numClasses; c++ {
			score := float64(data[(4+c)*rowLen+i])
			if score > bestScore {
				bestScore = score
				bestClass = c
			}
		}

		if bestScore < config.MinScore {
			continue
		}

		// Decode bounding box (center format -> corner format)
		cx := float64(data[0*rowLen+i])
		cy := float64(data[1*rowLen+i])
		w := float64(data[2*rowLen+i])
		h := float64(data[3*rowLen+i])

		// Convert from letterboxed coordinates to original image coordinates
		x1 := (cx - w/2 - padX) / scale
		y1 := (cy - h/2 - padY) / scale
		bw := w / scale
		bh := h / scale

		// Clamp to positive values
		if x1 < 0 {
			x1 = 0
		}
		if y1 < 0 {
			y1 = 0
		}

		label := ""
		if bestClass >= 0 && bestClass < len(COCOLabels) {
			label = COCOLabels[bestClass]
		} else {
			label = fmt.Sprintf("class_%d", bestClass)
		}

		detections = append(detections, Detection{
			Label:      label,
			ClassID:    bestClass,
			Confidence: bestScore,
			BoxX:       x1,
			BoxY:       y1,
			BoxWidth:   bw,
			BoxHeight:  bh,
		})
	}

	// Apply NMS per class
	detections = nmsPerClass(detections, config.NMSThreshold)

	// Sort by confidence descending and cap
	sort.Slice(detections, func(i, j int) bool {
		return detections[i].Confidence > detections[j].Confidence
	})
	if len(detections) > config.MaxDetections {
		detections = detections[:config.MaxDetections]
	}

	return detections
}

// nmsPerClass applies non-maximum suppression independently per class.
func nmsPerClass(detections []Detection, iouThreshold float64) []Detection {
	// Group by class
	byClass := map[int][]int{}
	for i, d := range detections {
		byClass[d.ClassID] = append(byClass[d.ClassID], i)
	}

	kept := make([]bool, len(detections))
	for _, indices := range byClass {
		// Sort indices by confidence descending
		sort.Slice(indices, func(a, b int) bool {
			return detections[indices[a]].Confidence > detections[indices[b]].Confidence
		})

		for i := 0; i < len(indices); i++ {
			if !kept[indices[i]] {
				// First time seeing this index — mark as kept initially
			}
			kept[indices[i]] = true
			for j := i + 1; j < len(indices); j++ {
				if !kept[indices[j]] {
					continue
				}
				if iou(detections[indices[i]], detections[indices[j]]) > iouThreshold {
					kept[indices[j]] = false
				}
			}
		}
	}

	var result []Detection
	for i, k := range kept {
		if k {
			result = append(result, detections[i])
		}
	}
	return result
}

// iou computes intersection over union between two detections.
func iou(a, b Detection) float64 {
	x1 := math.Max(a.BoxX, b.BoxX)
	y1 := math.Max(a.BoxY, b.BoxY)
	x2 := math.Min(a.BoxX+a.BoxWidth, b.BoxX+b.BoxWidth)
	y2 := math.Min(a.BoxY+a.BoxHeight, b.BoxY+b.BoxHeight)

	intersection := math.Max(0, x2-x1) * math.Max(0, y2-y1)
	if intersection == 0 {
		return 0
	}

	areaA := a.BoxWidth * a.BoxHeight
	areaB := b.BoxWidth * b.BoxHeight
	return intersection / (areaA + areaB - intersection)
}
