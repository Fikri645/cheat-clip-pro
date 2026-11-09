Light-ASD (CVPR 2023), Junhua Liao et al.
Source: https://github.com/Junhua-Liao/Light-ASD
Vendored commit: ed38c232de5efe0261dbd68627c0ade7cdfe14eb

Classifier.py, Encoder.py and Model.py preserve the upstream architecture.
Model.py imports were changed to package-relative imports; trailing whitespace was normalized. The upstream
MIT license is included in LICENSE. Training scripts and optimizer are not used.

The application loads the released pretrain_AVA_CVPR.model checkpoint, verifies
SHA-256 d44bc3ea7baa8e0946fa3921311714a630ed8b90a1928fab0dbe30d918909317,
and uses its model and lossAV.FC weights. Downloads are kept outside source code
under ML_MODEL_DIR/light-asd (or LIGHT_ASD_MODEL_PATH).
