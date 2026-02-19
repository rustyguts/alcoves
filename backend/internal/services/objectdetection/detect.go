package objectdetection

import (
	"fmt"
	"math"
	"sort"

	"github.com/davidbyttow/govips/v2/vips"
	ort "github.com/yalue/onnxruntime_go"
)

const (
	inputSize      = 640
	numClasses     = 80
	numProposals   = 300 // YOLO26x outputs exactly 300 NMS-free proposals
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

// DetectObjects runs YOLO26x inference on raw image data and returns detections.
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

	// Preprocess: resize to 640x640, normalize to [0, 1]
	inputTensor, err := preprocessForDetection(img)
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

	// Run inference — YOLO26x produces two outputs: logits and pred_boxes
	outputs := make([]ort.Value, 2)
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

	// logits: [1, 300, 80] — raw class scores (apply sigmoid for probabilities)
	logitsTensor := outputs[0].(*ort.Tensor[float32])
	logits := logitsTensor.GetData()

	// pred_boxes: [1, 300, 4] — normalized [cx, cy, w, h] in [0, 1]
	boxesTensor := outputs[1].(*ort.Tensor[float32])
	boxes := boxesTensor.GetData()

	detections := decodeYOLO26Output(logits, boxes, origW, origH, config)

	return detections, origW, origH, nil
}

// preprocessForDetection resizes the image to 640x640 and normalizes to [0, 1].
// YOLO26x uses a direct resize (no letterboxing) per its preprocessor config.
func preprocessForDetection(img *vips.ImageRef) ([]float32, error) {
	hScale := float64(inputSize) / float64(img.Width())
	vScale := float64(inputSize) / float64(img.Height())

	if err := img.ResizeWithVScale(hScale, vScale, vips.KernelLinear); err != nil {
		return nil, err
	}

	// Get raw RGB pixel data
	rawBytes, err := exportRawRGB(img)
	if err != nil {
		return nil, err
	}

	// Convert to CHW float32 normalized to [0, 1]
	pixels := inputSize * inputSize
	tensor := make([]float32, 3*pixels)
	for i := 0; i < pixels; i++ {
		tensor[i] = float32(rawBytes[i*3]) / 255.0            // R
		tensor[pixels+i] = float32(rawBytes[i*3+1]) / 255.0   // G
		tensor[2*pixels+i] = float32(rawBytes[i*3+2]) / 255.0 // B
	}

	return tensor, nil
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

// sigmoid applies the logistic sigmoid function.
func sigmoid(x float64) float64 {
	return 1.0 / (1.0 + math.Exp(-x))
}

// decodeYOLO26Output parses the YOLO26x outputs into detections.
// logits: [1, 300, 80] — raw class scores (pre-sigmoid)
// boxes:  [1, 300, 4]  — normalized [cx, cy, w, h] in [0, 1]
// YOLO26x is NMS-free: the 300 proposals are already deduplicated by the model.
func decodeYOLO26Output(logits, boxes []float32, origW, origH int, config *ObjectConfig) []Detection {
	if len(logits) < numProposals*numClasses || len(boxes) < numProposals*4 {
		return nil
	}

	var detections []Detection

	for i := 0; i < numProposals; i++ {
		// Find the class with the highest score (apply sigmoid)
		bestClass := -1
		bestScore := 0.0
		for c := 0; c < numClasses; c++ {
			score := sigmoid(float64(logits[i*numClasses+c]))
			if score > bestScore {
				bestScore = score
				bestClass = c
			}
		}

		if bestScore < config.MinScore {
			continue
		}

		// Decode bounding box — values are normalized to [0, 1]
		cx := float64(boxes[i*4+0])
		cy := float64(boxes[i*4+1])
		w := float64(boxes[i*4+2])
		h := float64(boxes[i*4+3])

		// Convert from normalized center format to pixel coordinates
		x1 := (cx - w/2) * float64(origW)
		y1 := (cy - h/2) * float64(origH)
		bw := w * float64(origW)
		bh := h * float64(origH)

		// Clamp to image bounds
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

	// Sort by confidence descending and cap at max detections
	sort.Slice(detections, func(i, j int) bool {
		return detections[i].Confidence > detections[j].Confidence
	})
	if len(detections) > config.MaxDetections {
		detections = detections[:config.MaxDetections]
	}

	return detections
}
