# JetBrains Mono Variable

The UI uses the upright variable font from [JetBrains Mono v2.304](https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304), with weights 100–800. It is self-hosted; no font service is contacted.

- Source: [`fonts/variable/JetBrainsMono[wght].ttf`](https://github.com/JetBrains/JetBrainsMono/blob/v2.304/fonts/variable/JetBrainsMono%5Bwght%5D.ttf)
- Upstream Git blob: `b60e77f5dbf5505436c1904cb7a9ac4111ee76d0`
- License: [SIL Open Font License 1.1](OFL.txt), copied from the same release.

`JetBrainsMono-Variable.woff2` is a WOFF2 compression of that TTF using fonttools 4.65.0 and Brotli 1.2.0. All glyphs and the variable weight axis are retained. To reproduce it with those tools installed and the upstream file saved as `JetBrainsMono-Variable.ttf`:

```python
from fontTools.ttLib import TTFont

font = TTFont("JetBrainsMono-Variable.ttf", recalcTimestamp=False)
font.flavor = "woff2"
font.save("JetBrainsMono-Variable.woff2")
```

Webpack emits both the font and `OFL.txt` into `dist/fonts/`. Keep the license and copyright notice with the font when distributing the app.
