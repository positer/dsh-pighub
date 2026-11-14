
import importlib
for m in ["scipy","scipy.ndimage","numpy","PIL"]:
    try:
        mod = importlib.import_module(m)
        print(m, "OK", getattr(mod,"__version__",""))
    except Exception as e:
        print(m, "MISSING", e)
