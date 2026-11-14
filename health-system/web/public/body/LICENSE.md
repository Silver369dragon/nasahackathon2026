# Orbital body model

`orbital-body.glb` is an original neutral mannequin created for this project from a continuous implicit surface. It contains no downloaded anatomy, scans, textures or personal likenesses.

Source: `web/tools/create-body-model.mjs`. Rebuild with Node.js and the project's installed Three.js dependency. The generated mesh has 22 anatomical regions, shared smooth normals, and no external textures or decoders.

The generated model is dedicated to the public domain under CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/

`preview.png` is a render of this same original model, covered by the same dedication. Recreate it with `node tools/create-body-preview.mjs` from `web/` using Playwright and the installed Chrome browser.

The generator uses Three.js MarchingCubes (MIT), with upstream attribution retained in the installed Three.js package. The model is a stylized interface asset, not an anatomical measurement.
