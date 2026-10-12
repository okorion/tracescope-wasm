import sys
from pathlib import Path
from fontTools import subset
root = Path(__file__).resolve().parent
options = subset.Options()
options.flavor = 'woff2'
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
font = subset.load_font(sys.argv[1], options)
worker = subset.Subsetter(options=options)
worker.populate(text=(root/'render.mjs').read_text(encoding='utf-8')+(root/'spec.json').read_text(encoding='utf-8')+''.join(chr(i) for i in range(32,127)))
worker.subset(font)
subset.save_font(font, str(root/'diagram-sans.woff2'), options)
