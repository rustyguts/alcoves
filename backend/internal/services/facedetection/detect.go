package facedetection

import (
	"fmt"
	"math"
	"sort"

	"github.com/davidbyttow/govips/v2/vips"
	ort "github.com/yalue/onnxruntime_go"
)

const (
	detInputSize  = 640
	nmsThreshold  = 0.4
	minFaceSize   = 20
	maxFaceCount  = 256
	minAspect     = 0.3
	maxAspect     = 3.0
)

// BoundingBox represents a face bounding box in pixel coordinates.
type BoundingBox struct {
	X      float64
	Y      float64
	Width  float64
	Height float64
}

// DetectedFace represents a single detected face.
type DetectedFace struct {
	Box        BoundingBox
	Landmarks  [5][2]float64 // 5-point facial landmarks (eyes, nose, mouth corners)
	Confidence float64
}

// DetectFaces runs the SCRFD detection model on image data and returns detected faces.
func DetectFaces(session *ort.DynamicAdvancedSession, imageData []byte, minScore float64) ([]DetectedFace, int, int, error) {
	// Load image with govips
	img, err := vips.NewImageFromBuffer(imageData)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("failed to load image: %w", err)
	}
	defer img.Close()

	origW := img.Width()
	origH := img.Height()

	// Letterbox resize to 640x640
	inputTensor, scaleX, scaleY, padX, padY, err := preprocessForDetection(img)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("preprocessing failed: %w", err)
	}

	// Create input tensor
	inputShape := ort.NewShape(1, 3, detInputSize, detInputSize)
	input, err := ort.NewTensor(inputShape, inputTensor)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("failed to create input tensor: %w", err)
	}
	defer input.Destroy()

	// Run inference — pass nil outputs so they are auto-allocated
	outputs := make([]ort.Value, 9) // 9 outputs: score_8/16/32, bbox_8/16/32, kps_8/16/32
	err = session.Run([]ort.Value{input}, outputs)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("inference failed: %w", err)
	}
	defer func() {
		for _, o := range outputs {
			if o != nil {
				o.Destroy()
			}
		}
	}()

	// Parse outputs by stride
	// Output order: score_8, score_16, score_32, bbox_8, bbox_16, bbox_32, kps_8, kps_16, kps_32
	strides := []int{8, 16, 32}

	var allFaces []DetectedFace
	for i, stride := range strides {
		scoreTensor := outputs[i].(*ort.Tensor[float32])
		bboxTensor := outputs[i+3].(*ort.Tensor[float32])
		kpsTensor := outputs[i+6].(*ort.Tensor[float32])

		scores := scoreTensor.GetData()
		bboxes := bboxTensor.GetData()
		kps := kpsTensor.GetData()

		scoreShape := scoreTensor.GetShape()
		anchorCount := int(scoreShape[1])

		faces := decodeStride(scores, bboxes, kps, stride, anchorCount, detInputSize, minScore)
		allFaces = append(allFaces, faces...)
	}

	// Apply NMS
	allFaces = nms(allFaces, nmsThreshold)

	// Map back to original image coordinates
	for i := range allFaces {
		f := &allFaces[i]
		f.Box.X = (f.Box.X - padX) / scaleX
		f.Box.Y = (f.Box.Y - padY) / scaleY
		f.Box.Width = f.Box.Width / scaleX
		f.Box.Height = f.Box.Height / scaleY

		for j := range f.Landmarks {
			f.Landmarks[j][0] = (f.Landmarks[j][0] - padX) / scaleX
			f.Landmarks[j][1] = (f.Landmarks[j][1] - padY) / scaleY
		}
	}

	// Filter: min size, aspect ratio, max count
	var filtered []DetectedFace
	for _, f := range allFaces {
		if f.Box.Width < minFaceSize || f.Box.Height < minFaceSize {
			continue
		}
		aspect := f.Box.Width / f.Box.Height
		if aspect < minAspect || aspect > maxAspect {
			continue
		}
		filtered = append(filtered, f)
	}

	// Sort by confidence descending and cap
	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].Confidence > filtered[j].Confidence
	})
	if len(filtered) > maxFaceCount {
		filtered = filtered[:maxFaceCount]
	}

	return filtered, origW, origH, nil
}

// preprocessForDetection resizes and pads the image to 640x640 with letterboxing.
// Returns the float32 CHW tensor and the transform parameters.
func preprocessForDetection(img *vips.ImageRef) ([]float32, float64, float64, float64, float64, error) {
	w := img.Width()
	h := img.Height()

	// Compute scale to fit within 640x640
	scale := math.Min(float64(detInputSize)/float64(w), float64(detInputSize)/float64(h))
	newW := int(math.Round(float64(w) * scale))
	newH := int(math.Round(float64(h) * scale))

	// Resize
	hScale := float64(newH) / float64(h)
	vScale := float64(newW) / float64(w)
	_ = hScale
	if err := img.Resize(vScale, vips.KernelLinear); err != nil {
		return nil, 0, 0, 0, 0, err
	}

	// Pad to 640x640 (add black border)
	padX := float64(detInputSize-newW) / 2
	padY := float64(detInputSize-newH) / 2
	padLeft := int(padX)
	padTop := int(padY)
	padRight := detInputSize - newW - padLeft
	padBottom := detInputSize - newH - padTop

	if err := img.Embed(padLeft, padTop, newW+padLeft+padRight, newH+padTop+padBottom, vips.ExtendBlack); err != nil {
		return nil, 0, 0, 0, 0, err
	}

	// Export to raw bytes (RGB)
	rawBytes, err := exportRGB(img)
	if err != nil {
		return nil, 0, 0, 0, 0, err
	}

	// Convert to CHW float32 with normalization: (pixel - 127.5) / 128.0
	tensor := make([]float32, 3*detInputSize*detInputSize)
	pixels := detInputSize * detInputSize
	for i := 0; i < pixels; i++ {
		r := float32(rawBytes[i*3]) - 127.5
		g := float32(rawBytes[i*3+1]) - 127.5
		b := float32(rawBytes[i*3+2]) - 127.5
		tensor[i] = r / 128.0            // R channel
		tensor[pixels+i] = g / 128.0     // G channel
		tensor[2*pixels+i] = b / 128.0   // B channel
	}

	return tensor, scale, scale, padX, padY, nil
}

// exportRGB exports a vips image as raw RGB bytes.
func exportRGB(img *vips.ImageRef) ([]byte, error) {
	// Ensure 3-band sRGB
	if err := img.ToColorSpace(vips.InterpretationSRGB); err != nil {
		return nil, err
	}
	// Remove alpha if present
	if img.Bands() > 3 {
		if err := img.Flatten(&vips.Color{R: 0, G: 0, B: 0}); err != nil {
			return nil, err
		}
	}

	// Write to memory in raw format
	buf, _, err := img.ExportNative()
	if err != nil {
		// Fallback: export as PNG and reload
		return nil, fmt.Errorf("failed to export raw: %w", err)
	}

	// govips ExportNative returns raw bytes for memory images
	// but for file-loaded images it exports in the source format.
	// We need to use a more reliable approach.
	_ = buf

	// Use a reliable raw export path
	return exportRawRGB(img)
}

// exportRawRGB reliably gets raw RGB pixel data from a vips image.
func exportRawRGB(img *vips.ImageRef) ([]byte, error) {
	// Export as BMP (uncompressed) and parse out the pixel data,
	// or use the Write to buffer approach.
	// The most reliable approach is to export as raw bytes via govips.
	params := vips.NewDefaultExportParams()
	params.Format = vips.ImageTypePNG
	pngData, _, err := img.Export(params)
	if err != nil {
		return nil, err
	}

	// Re-load from PNG to get a memory image, then get raw bytes
	memImg, err := vips.NewImageFromBuffer(pngData)
	if err != nil {
		return nil, err
	}
	defer memImg.Close()

	// Get pixel data row by row
	w := memImg.Width()
	h := memImg.Height()
	result := make([]byte, w*h*3)

	// Use WriteToBuffer with raw format
	// Actually, the simplest approach: iterate via the image's raw memory
	rawBytes, err := memImg.ToBytes()
	if err != nil {
		return nil, err
	}

	bands := memImg.Bands()
	for i := 0; i < w*h; i++ {
		result[i*3] = rawBytes[i*bands]
		result[i*3+1] = rawBytes[i*bands+1]
		result[i*3+2] = rawBytes[i*bands+2]
	}

	return result, nil
}

// decodeStride decodes detections for a single stride level.
func decodeStride(scores, bboxes, kps []float32, stride, anchorCount, inputSize int, minScore float64) []DetectedFace {
	gridSize := inputSize / stride
	var faces []DetectedFace

	for y := 0; y < gridSize; y++ {
		for x := 0; x < gridSize; x++ {
			for a := 0; a < anchorCount; a++ {
				idx := (y*gridSize + x) * anchorCount + a
				if idx >= len(scores) {
					continue
				}
				score := float64(scores[idx])
				if score < minScore {
					continue
				}

				// Anchor center
				cx := (float64(x) + 0.5) * float64(stride)
				cy := (float64(y) + 0.5) * float64(stride)

				// Decode bounding box (distance format)
				bIdx := idx * 4
				if bIdx+3 >= len(bboxes) {
					continue
				}
				left := float64(bboxes[bIdx]) * float64(stride)
				top := float64(bboxes[bIdx+1]) * float64(stride)
				right := float64(bboxes[bIdx+2]) * float64(stride)
				bottom := float64(bboxes[bIdx+3]) * float64(stride)

				bx := cx - left
				by := cy - top
				bw := left + right
				bh := top + bottom

				// Decode landmarks
				var landmarks [5][2]float64
				kIdx := idx * 10
				if kIdx+9 < len(kps) {
					for l := 0; l < 5; l++ {
						landmarks[l][0] = cx + float64(kps[kIdx+l*2])*float64(stride)
						landmarks[l][1] = cy + float64(kps[kIdx+l*2+1])*float64(stride)
					}
				}

				faces = append(faces, DetectedFace{
					Box: BoundingBox{
						X:      bx,
						Y:      by,
						Width:  bw,
						Height: bh,
					},
					Landmarks:  landmarks,
					Confidence: score,
				})
			}
		}
	}

	return faces
}

// nms performs non-maximum suppression on detected faces.
func nms(faces []DetectedFace, iouThreshold float64) []DetectedFace {
	if len(faces) == 0 {
		return faces
	}

	// Sort by confidence descending
	sort.Slice(faces, func(i, j int) bool {
		return faces[i].Confidence > faces[j].Confidence
	})

	kept := make([]bool, len(faces))
	for i := range kept {
		kept[i] = true
	}

	for i := 0; i < len(faces); i++ {
		if !kept[i] {
			continue
		}
		for j := i + 1; j < len(faces); j++ {
			if !kept[j] {
				continue
			}
			if iou(faces[i].Box, faces[j].Box) > iouThreshold {
				kept[j] = false
			}
		}
	}

	var result []DetectedFace
	for i, k := range kept {
		if k {
			result = append(result, faces[i])
		}
	}
	return result
}

// iou computes intersection over union between two bounding boxes.
func iou(a, b BoundingBox) float64 {
	x1 := math.Max(a.X, b.X)
	y1 := math.Max(a.Y, b.Y)
	x2 := math.Min(a.X+a.Width, b.X+b.Width)
	y2 := math.Min(a.Y+a.Height, b.Y+b.Height)

	intersection := math.Max(0, x2-x1) * math.Max(0, y2-y1)
	if intersection == 0 {
		return 0
	}

	areaA := a.Width * a.Height
	areaB := b.Width * b.Height
	return intersection / (areaA + areaB - intersection)
}
