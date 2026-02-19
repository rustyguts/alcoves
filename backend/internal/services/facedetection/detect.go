package facedetection

import (
	"fmt"
	"math"
	"sort"

	"github.com/davidbyttow/govips/v2/vips"
	ort "github.com/yalue/onnxruntime_go"
)

const (
	detInputSize      = 640
	nmsThreshold      = 0.4
	minFaceSize       = 20
	maxFaceCount      = 256
	minAspect         = 0.3
	maxAspect         = 3.0
	numAnchorsPerCell = 2 // SCRFD det_10g uses 2 anchors per grid cell
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
	// Load image with govips and apply EXIF rotation so detection runs on
	// the correctly-oriented pixels (matching what users see in browsers).
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

	// Resize to fit within 640x640 with top-left padding (matching InsightFace reference).
	inputTensor, detScale, err := preprocessForDetection(img)
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

	// Parse outputs by stride.
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

		faces := decodeStride(scores, bboxes, kps, stride, detInputSize, minScore)
		allFaces = append(allFaces, faces...)
	}

	// Apply NMS
	allFaces = nms(allFaces, nmsThreshold)

	// Map back to original image coordinates by dividing by detScale.
	// The resized image is placed at origin (0,0) so no padding offset is needed.
	for i := range allFaces {
		f := &allFaces[i]
		f.Box.X /= detScale
		f.Box.Y /= detScale
		f.Box.Width /= detScale
		f.Box.Height /= detScale

		for j := range f.Landmarks {
			f.Landmarks[j][0] /= detScale
			f.Landmarks[j][1] /= detScale
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

// preprocessForDetection resizes the image to fit within 640x640, pads with black
// at the right/bottom edges (top-left aligned, matching InsightFace reference),
// and returns the float32 CHW tensor plus the detection scale factor.
func preprocessForDetection(img *vips.ImageRef) ([]float32, float64, error) {
	w := img.Width()
	h := img.Height()

	// Compute scale to fit the longer side into 640 pixels.
	// This matches the reference: det_scale = float(new_height) / img.shape[0]
	// where new_height is computed from the aspect ratio.
	ratio := float64(h) / float64(w)
	var newW, newH int
	if ratio > 1.0 {
		// Portrait: height is the constraining dimension
		newH = detInputSize
		newW = int(float64(detInputSize) / ratio)
	} else {
		// Landscape or square: width is the constraining dimension
		newW = detInputSize
		newH = int(float64(newW) * ratio)
	}
	detScale := float64(newH) / float64(h)

	// Resize
	if err := img.Resize(detScale, vips.KernelLinear); err != nil {
		return nil, 0, err
	}

	// Pad to 640x640 with black at right/bottom (top-left aligned).
	actualW := img.Width()
	actualH := img.Height()
	if actualW < detInputSize || actualH < detInputSize {
		if err := img.Embed(0, 0, detInputSize, detInputSize, vips.ExtendBlack); err != nil {
			return nil, 0, err
		}
	}

	// Export to raw bytes (RGB)
	rawBytes, err := exportRGB(img)
	if err != nil {
		return nil, 0, err
	}

	// Convert to CHW float32 with normalization: (pixel - 127.5) / 128.0
	tensor := make([]float32, 3*detInputSize*detInputSize)
	pixels := detInputSize * detInputSize
	for i := 0; i < pixels; i++ {
		r := float32(rawBytes[i*3]) - 127.5
		g := float32(rawBytes[i*3+1]) - 127.5
		b := float32(rawBytes[i*3+2]) - 127.5
		tensor[i] = r / 128.0          // R channel
		tensor[pixels+i] = g / 128.0   // G channel
		tensor[2*pixels+i] = b / 128.0 // B channel
	}

	return tensor, detScale, nil
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
// Matches the InsightFace SCRFD reference implementation.
//
// The score tensor is [1, totalAnchors, 1] (batched) where totalAnchors = H * W * numAnchorsPerCell.
// The bbox tensor is [1, totalAnchors, 4] with distance predictions (left, top, right, bottom).
// The kps tensor is [1, totalAnchors, 10] with landmark offsets.
//
// Anchor centers are computed as (x * stride, y * stride) for each grid position, repeated
// for each anchor per cell.
func decodeStride(scores, bboxes, kps []float32, stride, inputSize int, minScore float64) []DetectedFace {
	gridH := inputSize / stride
	gridW := inputSize / stride
	numCells := gridH * gridW

	// Build anchor centers: for each (y, x) grid cell, repeated numAnchorsPerCell times.
	// Order: all anchors for (0,0), all anchors for (0,1), ..., matching InsightFace's
	// np.stack(np.mgrid[:height, :width][::-1], axis=-1) with anchor stacking.
	anchorCenters := make([][2]float64, numCells*numAnchorsPerCell)
	idx := 0
	for y := 0; y < gridH; y++ {
		for x := 0; x < gridW; x++ {
			cx := float64(x) * float64(stride)
			cy := float64(y) * float64(stride)
			for a := 0; a < numAnchorsPerCell; a++ {
				anchorCenters[idx] = [2]float64{cx, cy}
				idx++
			}
		}
	}

	totalAnchors := len(anchorCenters)
	var faces []DetectedFace

	for i := 0; i < totalAnchors; i++ {
		if i >= len(scores) {
			break
		}
		score := float64(scores[i])
		if score < minScore {
			continue
		}

		cx := anchorCenters[i][0]
		cy := anchorCenters[i][1]

		// Decode bounding box: distance format -> (x1, y1, x2, y2) -> (x, y, w, h)
		bIdx := i * 4
		if bIdx+3 >= len(bboxes) {
			continue
		}
		x1 := cx - float64(bboxes[bIdx])*float64(stride)
		y1 := cy - float64(bboxes[bIdx+1])*float64(stride)
		x2 := cx + float64(bboxes[bIdx+2])*float64(stride)
		y2 := cy + float64(bboxes[bIdx+3])*float64(stride)

		// Decode landmarks
		var landmarks [5][2]float64
		kIdx := i * 10
		if kIdx+9 < len(kps) {
			for l := 0; l < 5; l++ {
				landmarks[l][0] = cx + float64(kps[kIdx+l*2])*float64(stride)
				landmarks[l][1] = cy + float64(kps[kIdx+l*2+1])*float64(stride)
			}
		}

		faces = append(faces, DetectedFace{
			Box: BoundingBox{
				X:      x1,
				Y:      y1,
				Width:  x2 - x1,
				Height: y2 - y1,
			},
			Landmarks:  landmarks,
			Confidence: score,
		})
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
