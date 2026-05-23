# Third-Party Notices

Wren (the "Software") is licensed under the MIT License (see [LICENSE](./LICENSE)).
It is built with, links against, and/or distributes the third-party open-source
components listed below. Each is the property of its respective authors and is
used under its own license. This file collects the licenses and required notices.

This list covers the significant components. For an exhaustive, machine-generated
manifest of every transitive dependency you can run:

```bash
# Rust crates
cargo install cargo-about && cargo about generate about.hbs > rust-licenses.html
# npm packages
npx license-checker --production --summary
```

---

## 1. Bundled / runtime components

These ship inside the application bundle or are downloaded at runtime.

### PDFium

Used for PDF rasterization (the `libpdfium` dynamic library). License:
**BSD-3-Clause**. Copyright © The PDFium Authors. Portions Copyright © 2014 Google
Inc. The BSD-3-Clause text below applies:

```
Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice, this
      list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimer in the documentation
      and/or other materials provided with the distribution.
    * Neither the name of Google Inc. nor the names of its contributors may be
      used to endorse or promote products derived from this software without
      specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES ... (full BSD-3-Clause disclaimer, see §6).
```

### ONNX Runtime

Used (via the `ort` crate, with prebuilt binaries) to run the document-analysis
models. License: **MIT**. Copyright © Microsoft Corporation.

### PaddleOCR models (downloaded at runtime)

Wren downloads the following ONNX models and dictionaries on first PDF parse, from
the ModelScope mirror [`greatv/oar-ocr`](https://www.modelscope.cn/models/greatv/oar-ocr):

- `pp-doclayout-s.onnx` (PP-DocLayout, layout analysis)
- `pp-ocrv5_mobile_det.onnx`, `pp-ocrv5_mobile_rec.onnx`, `ppocrv5_dict.txt` (PP-OCRv5, text detection/recognition)
- `pp-lcnet_x1_0_table_cls.onnx`, `slanet_plus.onnx`, `table_structure_dict_ch.txt` (table recognition)

These are part of the [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)
project. License: **Apache-2.0**. Copyright © PaddlePaddle Authors.

---

## 2. Rust dependencies (selected)

| Component | License |
|---|---|
| `tauri` and official Tauri plugins | MIT OR Apache-2.0 |
| `oar-ocr`, `oar-ocr-core` | Apache-2.0 |
| `ort` (ONNX Runtime bindings) | MIT OR Apache-2.0 |
| `pdfium-render` | MIT OR Apache-2.0 |
| `tantivy` (full-text search) | MIT |
| `lancedb`, `lance`, `arrow`, `datafusion` | Apache-2.0 |
| `sqlx` | MIT OR Apache-2.0 |
| `tokio`, `serde`, `serde_json`, `anyhow`, `thiserror` | MIT OR Apache-2.0 |
| `reqwest`, `axum`, `image`, `ndarray`, `regex`, `uuid`, `chrono` | MIT OR Apache-2.0 |
| `lopdf` | MIT OR Apache-2.0 |
| `comrak` (Markdown) | BSD-2-Clause (bundles `syntect`, MIT) |
| `biblatex` | MIT OR Apache-2.0 |
| `epub`, `html2text`, `directories`, `dirs` | MIT / Apache-2.0 |
| `sha2`, `hex` | MIT OR Apache-2.0 |
| `undoc` (Office document parsing) | see https://github.com/iyulab/undoc |

## 3. Frontend (npm) dependencies (selected)

| Component | License |
|---|---|
| `react`, `react-dom` | MIT (© Meta Platforms, Inc.) |
| `@tauri-apps/api` and plugins | MIT OR Apache-2.0 |
| `@radix-ui/*` | MIT |
| `@codemirror/*`, `@lezer/*`, `codemirror` | MIT |
| `@codemirror/theme-one-dark` | MIT (derived from Atom One Dark) |
| `@tabler/icons-react` | MIT |
| `lucide-react` | ISC |
| `shiki` (syntax highlighting + grammars) | MIT |
| `katex` (code) | MIT — KaTeX **fonts** are SIL OFL-1.1 (see §4) |
| `pdfjs-dist` | Apache-2.0 (© Mozilla) |
| `pdf-lib` | MIT |
| `dompurify` | Apache-2.0 OR MPL-2.0 (used under Apache-2.0) |
| `epubjs` | BSD-2-Clause |
| `react-markdown`, `remark-gfm` | MIT |
| `react-force-graph-2d` | MIT |
| `@dnd-kit/*`, `@tanstack/react-virtual` | MIT |
| `react-resizable-panels`, `react-rnd` | MIT |
| `zustand`, `cmdk`, `clsx`, `class-variance-authority`, `tailwind-merge`, `lodash.debounce` | MIT |
| `tailwindcss`, `@tailwindcss/typography`, `autoprefixer`, `postcss` | MIT |
| `vite`, `@vitejs/plugin-react` | MIT |
| `typescript` | Apache-2.0 |

## 4. Fonts

- **KaTeX fonts** (`KaTeX_*`) — SIL Open Font License 1.1 (see §6). Reserved Font
  Name: "KaTeX".

---

## 5. Notes on Apache-2.0 components

For components licensed under the Apache License 2.0 (oar-ocr, ONNX Runtime,
PaddleOCR models, LanceDB/Arrow/DataFusion, pdf.js, TypeScript, and others), the
full license text is reproduced in §6. Where those projects ship a `NOTICE` file,
its attributions are incorporated here by reference to the upstream repositories.

---

## 6. Full license texts

The components above are distributed under the following licenses. Each full text
applies to the components attributed to it above.

### MIT License

```
Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### ISC License

```
Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT,
OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS
ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS
SOFTWARE.
```

### BSD 2-Clause License

```
Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this
   list of conditions and the following disclaimer in the documentation and/or
   other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

### BSD 3-Clause License

```
Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this
   list of conditions and the following disclaimer in the documentation and/or
   other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may
   be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

### Apache License 2.0

The full text of the Apache License, Version 2.0 is available at
<https://www.apache.org/licenses/LICENSE-2.0>. A copy is reproduced below.

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   Licensed under the Apache License, Version 2.0 (the "License"); you may not
   use this file except in compliance with the License. You may obtain a copy of
   the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
   WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
   License for the specific language governing permissions and limitations under
   the License.

   (The complete Apache-2.0 text, including the TERMS AND CONDITIONS sections
   1–9 and the appendix, applies and is incorporated here by reference from the
   URL above.)
```

### Mozilla Public License 2.0 (referenced)

`dompurify` is dual-licensed Apache-2.0 OR MPL-2.0 and is used here under
Apache-2.0. The MPL-2.0 text, if needed, is available at
<https://www.mozilla.org/MPL/2.0/>.

### SIL Open Font License, Version 1.1

```
PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide development of
collaborative font projects, to support the font creation efforts of academic and
linguistic communities, and to provide a free and open framework in which fonts
may be shared and improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and redistributed
freely as long as they are not sold by themselves. The fonts, including any
derivative works, can be bundled, embedded, redistributed and/or sold with any
software provided that any reserved names are not used by derivative works. The
fonts and derivatives, however, cannot be released under any other type of
license. The requirement for fonts to remain under this license does not apply to
any document created using the fonts or their derivatives.

The full SIL OFL 1.1 text, including the PERMISSION & CONDITIONS and TERMINATION
sections, is available at <https://openfontlicense.org> and applies to the KaTeX
fonts (Reserved Font Name: "KaTeX").
```

---

If you believe a component is missing or misattributed here, please open an issue
so it can be corrected.
