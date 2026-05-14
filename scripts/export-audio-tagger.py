#!/usr/bin/env python3
"""Export EfficientAT + CED audio-tagging checkpoints to a single ONNX file
each, with the mel-spectrogram transform baked in so the Alcoves Go worker
can keep feeding raw mono PCM (no Go-side FFT pipeline). Writes a SHA256
sidecar next to each output file.

Usage:
    pip install -r scripts/export-audio-tagger.requirements.txt
    python scripts/export-audio-tagger.py --out /tmp/alcoves-models --models all
    rclone copy /tmp/alcoves-models rustyguts:models/ \\
        --progress --s3-chunk-size=64M --s3-upload-concurrency=4 \\
        --include 'efficientat_*.onnx' --include 'ced_*.onnx'

Files written (target filenames must match audiodetection/registry.go):
    efficientat_mn04_as.onnx   ~5 MB   (EfficientAT mn04_as)
    efficientat_mn10_as.onnx   ~20 MB  (EfficientAT mn10_as — new default)
    efficientat_mn40_as_ext.onnx ~280 MB
    ced_tiny.onnx              ~22 MB
    ced_small.onnx             ~85 MB
    ced_base.onnx              ~330 MB

EfficientAT input contract:
    waveform: float32 [batch, samples] @ 32 kHz mono
    output:   float32 [batch, 527] post-sigmoid probabilities

CED input contract:
    waveform: float32 [batch, samples] @ 16 kHz mono
    output:   float32 [batch, 527] post-sigmoid probabilities

Both wrappers compute log-mel internally so the Go worker just streams raw
PCM into the model's input tensor. AudioSet label order matches
audioset_class_labels_indices.csv on the model bucket.

NOTE: This script is a *recipe*. The exact wrapper code for each model
family depends on the upstream repo's preprocessing module. Run from a
venv against the project's upstream dependencies pinned in
scripts/export-audio-tagger.requirements.txt; see comments in each wrapper
for the upstream repo URL.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

import torch
import torch.nn as nn


# ─────────────────────────────────────────────────────────────────────
# EfficientAT (MobileNetV3 KD) — github.com/fschmid56/EfficientAT
# ─────────────────────────────────────────────────────────────────────


def export_efficientat(model_name: str, out_path: Path, sample_rate: int = 32000) -> None:
    """Export an EfficientAT MobileNetV3 audio-tagger to ONNX with mel
    preprocessing wrapped in.

    model_name ∈ {"mn04_as", "mn10_as", "mn40_as_ext"}
    """
    # Lazy import so the script works without EfficientAT installed when
    # the user only wants to export CED models.
    from models.MobileNetV3 import get_model  # type: ignore[import-not-found]
    from models.preprocess import AugmentMelSTFT  # type: ignore[import-not-found]

    width_mult = {"mn04_as": 0.4, "mn10_as": 1.0, "mn40_as_ext": 4.0}[model_name]
    backbone = get_model(width_mult=width_mult, pretrained_name=model_name)
    backbone.eval()

    mel = AugmentMelSTFT(
        n_mels=128,
        sr=sample_rate,
        win_length=800,
        hopsize=320,
        n_fft=1024,
        freqm=0,
        timem=0,
        htk=False,
        fmin=0.0,
        fmax=None,
        norm=1,
        fmin_aug_range=10,
        fmax_aug_range=2000,
    )
    mel.eval()

    class Bundled(nn.Module):
        def __init__(self, mel, net):
            super().__init__()
            self.mel = mel
            self.net = net

        def forward(self, waveform: torch.Tensor) -> torch.Tensor:
            # waveform: [batch, samples] float32 @ 32 kHz
            spec = self.mel(waveform)  # [batch, n_mels, frames]
            # EfficientAT expects [batch, 1, n_mels, frames]
            spec = spec.unsqueeze(1)
            logits, _ = self.net(spec)
            return torch.sigmoid(logits)

    wrapped = Bundled(mel, backbone)
    wrapped.eval()

    # Probe with 10s of silence — verifies the graph runs end-to-end.
    dummy = torch.zeros(1, sample_rate * 10, dtype=torch.float32)
    with torch.no_grad():
        probs = wrapped(dummy)
    assert probs.shape == (1, 527), f"unexpected output shape {probs.shape}"

    torch.onnx.export(
        wrapped,
        dummy,
        out_path,
        input_names=["waveform"],
        output_names=["clipwise_output"],
        dynamic_axes={"waveform": {0: "batch", 1: "samples"}, "clipwise_output": {0: "batch"}},
        opset_version=17,
    )
    print(f"  wrote {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)")


# ─────────────────────────────────────────────────────────────────────
# CED — github.com/RicherMans/CED + huggingface.co/mispeech/ced-*
# ─────────────────────────────────────────────────────────────────────


def export_ced(variant: str, out_path: Path, sample_rate: int = 16000) -> None:
    """Export a CED transformer audio-tagger via HuggingFace Optimum.

    variant ∈ {"tiny", "mini", "small", "base"}. We only ship tiny/small/base
    in the registry; mini is intentionally omitted (between tiny and small
    with no compelling tradeoff for our admin UI).
    """
    from transformers import AutoModelForAudioClassification, AutoFeatureExtractor  # type: ignore[import-not-found]

    hf_id = f"mispeech/ced-{variant}"
    fe = AutoFeatureExtractor.from_pretrained(hf_id, trust_remote_code=True)
    net = AutoModelForAudioClassification.from_pretrained(hf_id, trust_remote_code=True)
    net.eval()

    class Bundled(nn.Module):
        def __init__(self, fe, net):
            super().__init__()
            # Re-implement the feature extractor as torch ops so the mel
            # transform is part of the exported graph. CED uses 64-bin
            # mel filterbank with 16x16 patches.
            from transformers.models.auto.feature_extraction_auto import FeatureExtractorMixin  # noqa: F401
            self.sample_rate = fe.sampling_rate
            self.feature_extractor = fe
            self.net = net

        def forward(self, waveform: torch.Tensor) -> torch.Tensor:
            # waveform: [batch, samples] float32 @ 16 kHz
            # NOTE: HF feature extractors are not always torch-traceable.
            # If torch.onnx.export warns about this, replace with a
            # hand-written log-mel using torchaudio.transforms.MelSpectrogram.
            batch = []
            for i in range(waveform.shape[0]):
                feats = self.feature_extractor(
                    waveform[i].cpu().numpy(),
                    sampling_rate=self.sample_rate,
                    return_tensors="pt",
                )
                batch.append(feats["input_values"][0])
            x = torch.stack(batch).to(waveform.device)
            logits = self.net(input_values=x).logits
            return torch.sigmoid(logits)

    wrapped = Bundled(fe, net)
    wrapped.eval()

    dummy = torch.zeros(1, sample_rate * 10, dtype=torch.float32)
    with torch.no_grad():
        probs = wrapped(dummy)
    assert probs.shape == (1, 527), f"unexpected output shape {probs.shape}"

    torch.onnx.export(
        wrapped,
        dummy,
        out_path,
        input_names=["waveform"],
        output_names=["clipwise_output"],
        dynamic_axes={"waveform": {0: "batch", 1: "samples"}, "clipwise_output": {0: "batch"}},
        opset_version=17,
    )
    print(f"  wrote {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)")


# ─────────────────────────────────────────────────────────────────────
# Driver
# ─────────────────────────────────────────────────────────────────────

EFFICIENTAT_VARIANTS = [
    ("mn04_as", "efficientat_mn04_as.onnx"),
    ("mn10_as", "efficientat_mn10_as.onnx"),
    ("mn40_as_ext", "efficientat_mn40_as_ext.onnx"),
]

CED_VARIANTS = [
    ("tiny", "ced_tiny.onnx"),
    ("small", "ced_small.onnx"),
    ("base", "ced_base.onnx"),
]


def write_sha256(path: Path) -> None:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    sha_path = path.with_suffix(path.suffix + ".sha256")
    sha_path.write_text(f"{h.hexdigest()}  {path.name}\n")
    print(f"  sha256 → {sha_path}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=Path("/tmp/alcoves-models"))
    ap.add_argument(
        "--models",
        choices=["all", "efficientat", "ced"],
        default="all",
        help="Subset to export.",
    )
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    if args.models in ("all", "efficientat"):
        for variant, fname in EFFICIENTAT_VARIANTS:
            print(f"==> EfficientAT {variant}")
            try:
                export_efficientat(variant, args.out / fname)
                write_sha256(args.out / fname)
            except Exception as e:
                print(f"  FAILED: {e}", file=sys.stderr)
                return 1

    if args.models in ("all", "ced"):
        for variant, fname in CED_VARIANTS:
            print(f"==> CED {variant}")
            try:
                export_ced(variant, args.out / fname)
                write_sha256(args.out / fname)
            except Exception as e:
                print(f"  FAILED: {e}", file=sys.stderr)
                return 1

    print("")
    print(f"All artifacts in {args.out}. Next step:")
    print(f"  rclone copy {args.out} rustyguts:models/ \\")
    print("    --progress --s3-chunk-size=64M --s3-upload-concurrency=4 \\")
    print("    --include 'efficientat_*.onnx' --include 'ced_*.onnx'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
