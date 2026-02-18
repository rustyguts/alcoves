package facedetection

import (
	"fmt"
	"math"

	"github.com/davidbyttow/govips/v2/vips"
	ort "github.com/yalue/onnxruntime_go"
)

const (
	arcFaceSize = 112 // ArcFace input size
	embDim      = 512 // Embedding dimension
)

// Standard ArcFace 112x112 reference landmarks.
var referenceLandmarks = [5][2]float64{
	{38.2946, 51.6963},
	{73.5318, 51.5014},
	{56.0252, 71.7366},
	{41.5493, 92.3655},
	{70.7299, 92.2041},
}

// ComputeEmbedding extracts a 512-dim face embedding using the ArcFace model.
func ComputeEmbedding(session *ort.DynamicAdvancedSession, imageData []byte, face DetectedFace) ([]float32, error) {
	img, err := vips.NewImageFromBuffer(imageData)
	if err != nil {
		return nil, fmt.Errorf("failed to load image: %w", err)
	}
	defer img.Close()

	// Apply EXIF rotation to match the orientation used during detection.
	if err := img.AutoRotate(); err != nil {
		return nil, fmt.Errorf("failed to auto-rotate image: %w", err)
	}

	// Compute affine transform from detected landmarks to reference landmarks
	aligned, err := alignFace(img, face.Landmarks)
	if err != nil {
		return nil, fmt.Errorf("face alignment failed: %w", err)
	}

	// Convert aligned face to CHW float32 tensor
	tensor, err := prepareRecognitionInput(aligned)
	if err != nil {
		return nil, fmt.Errorf("tensor preparation failed: %w", err)
	}

	// Create input tensor
	inputShape := ort.NewShape(1, 3, arcFaceSize, arcFaceSize)
	input, err := ort.NewTensor(inputShape, tensor)
	if err != nil {
		return nil, fmt.Errorf("failed to create input tensor: %w", err)
	}
	defer input.Destroy()

	// Run inference — pass nil output so it's auto-allocated
	outputs := make([]ort.Value, 1)
	err = session.Run([]ort.Value{input}, outputs)
	if err != nil {
		return nil, fmt.Errorf("inference failed: %w", err)
	}
	defer func() {
		for _, o := range outputs {
			if o != nil {
				o.Destroy()
			}
		}
	}()

	embTensor := outputs[0].(*ort.Tensor[float32])
	rawEmb := embTensor.GetData()

	// L2-normalize the embedding
	embedding := make([]float32, embDim)
	copy(embedding, rawEmb[:embDim])
	l2Normalize(embedding)

	return embedding, nil
}

// alignFace warps the face region to a canonical 112x112 aligned image
// using a similarity transform estimated from detected to reference landmarks.
func alignFace(img *vips.ImageRef, landmarks [5][2]float64) ([]byte, error) {
	// Estimate similarity transform: reference = scale * R * detected + t
	// Using Umeyama algorithm (simplified for 2D similarity)
	M := estimateSimilarityTransform(landmarks, referenceLandmarks)

	// Get raw RGB pixels from source image
	srcRGB, err := exportRawRGB(img)
	if err != nil {
		return nil, err
	}
	srcW := img.Width()
	srcH := img.Height()

	// Invert M to get the mapping: for each output pixel, where in the source?
	invM := invertAffine(M)

	// Bilinear interpolation warp to 112x112
	dst := make([]byte, arcFaceSize*arcFaceSize*3)
	for y := 0; y < arcFaceSize; y++ {
		for x := 0; x < arcFaceSize; x++ {
			// Map destination to source
			sx := invM[0]*float64(x) + invM[1]*float64(y) + invM[2]
			sy := invM[3]*float64(x) + invM[4]*float64(y) + invM[5]

			r, g, b := bilinearSample(srcRGB, srcW, srcH, sx, sy)
			idx := (y*arcFaceSize + x) * 3
			dst[idx] = r
			dst[idx+1] = g
			dst[idx+2] = b
		}
	}

	return dst, nil
}

// prepareRecognitionInput converts 112x112 RGB bytes to CHW float32 tensor.
func prepareRecognitionInput(rgbData []byte) ([]float32, error) {
	pixels := arcFaceSize * arcFaceSize
	if len(rgbData) < pixels*3 {
		return nil, fmt.Errorf("insufficient RGB data: got %d, need %d", len(rgbData), pixels*3)
	}

	tensor := make([]float32, 3*pixels)
	for i := 0; i < pixels; i++ {
		r := float32(rgbData[i*3])
		g := float32(rgbData[i*3+1])
		b := float32(rgbData[i*3+2])
		tensor[i] = (r - 127.5) / 127.5
		tensor[pixels+i] = (g - 127.5) / 127.5
		tensor[2*pixels+i] = (b - 127.5) / 127.5
	}
	return tensor, nil
}

// estimateSimilarityTransform computes a 2D similarity transform (rotation, scale, translation)
// that maps src points to dst points. Returns [a, b, tx, -b, a, ty] (6 params).
func estimateSimilarityTransform(src, dst [5][2]float64) [6]float64 {
	n := len(src)

	// Compute centroids
	var srcCx, srcCy, dstCx, dstCy float64
	for i := 0; i < n; i++ {
		srcCx += src[i][0]
		srcCy += src[i][1]
		dstCx += dst[i][0]
		dstCy += dst[i][1]
	}
	srcCx /= float64(n)
	srcCy /= float64(n)
	dstCx /= float64(n)
	dstCy /= float64(n)

	// Compute scale and rotation using Procrustes
	var num, den float64
	for i := 0; i < n; i++ {
		sx := src[i][0] - srcCx
		sy := src[i][1] - srcCy
		dx := dst[i][0] - dstCx
		dy := dst[i][1] - dstCy

		num += dx*sx + dy*sy
		den += sx*sx + sy*sy
	}

	var numR, denR float64
	for i := 0; i < n; i++ {
		sx := src[i][0] - srcCx
		sy := src[i][1] - srcCy
		dx := dst[i][0] - dstCx
		dy := dst[i][1] - dstCy

		numR += dx*sy - dy*sx
		denR += sx*sx + sy*sy
	}

	a := num / den   // scale * cos(theta)
	b := numR / denR // scale * sin(theta)

	tx := dstCx - a*srcCx - b*srcCy
	ty := dstCy + b*srcCx - a*srcCy

	// Affine matrix: [a, b, tx, -b, a, ty]
	return [6]float64{a, b, tx, -b, a, ty}
}

// invertAffine inverts a 2x3 similarity transform [a, b, tx, -b, a, ty].
func invertAffine(M [6]float64) [6]float64 {
	a, b, tx := M[0], M[1], M[2]
	ty := M[5]

	det := a*a + b*b
	if det == 0 {
		return [6]float64{1, 0, 0, 0, 1, 0} // identity fallback
	}

	invA := a / det
	invB := -b / det

	invTx := -(invA*tx + invB*ty)
	invTy := -(-invB*tx + invA*ty)

	return [6]float64{invA, invB, invTx, -invB, invA, invTy}
}

// bilinearSample samples a pixel from RGB data using bilinear interpolation.
func bilinearSample(rgb []byte, w, h int, x, y float64) (byte, byte, byte) {
	x0 := int(math.Floor(x))
	y0 := int(math.Floor(y))
	x1 := x0 + 1
	y1 := y0 + 1

	// Clamp to image bounds
	x0 = clampInt(x0, 0, w-1)
	y0 = clampInt(y0, 0, h-1)
	x1 = clampInt(x1, 0, w-1)
	y1 = clampInt(y1, 0, h-1)

	fx := x - math.Floor(x)
	fy := y - math.Floor(y)

	var r, g, b float64
	for _, pt := range [4]struct {
		px, py int
		wt     float64
	}{
		{x0, y0, (1 - fx) * (1 - fy)},
		{x1, y0, fx * (1 - fy)},
		{x0, y1, (1 - fx) * fy},
		{x1, y1, fx * fy},
	} {
		idx := (pt.py*w + pt.px) * 3
		if idx+2 < len(rgb) {
			r += float64(rgb[idx]) * pt.wt
			g += float64(rgb[idx+1]) * pt.wt
			b += float64(rgb[idx+2]) * pt.wt
		}
	}

	return byte(clampFloat(r, 0, 255)),
		byte(clampFloat(g, 0, 255)),
		byte(clampFloat(b, 0, 255))
}

// l2Normalize normalizes a vector in-place to unit length.
func l2Normalize(v []float32) {
	var norm float64
	for _, val := range v {
		norm += float64(val) * float64(val)
	}
	norm = math.Sqrt(norm)
	if norm == 0 {
		return
	}
	for i := range v {
		v[i] = float32(float64(v[i]) / norm)
	}
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampFloat(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
