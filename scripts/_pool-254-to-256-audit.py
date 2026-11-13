# -*- coding: utf-8 -*-
"""临时探针：对指定图片跑 audit-completeness.py 的 audit()（importlib 复用，不复制算法，
见 taste.md §H.5）。只为「新候选有没有被画布直切」这一条读数服务，不进管线。"""
import importlib.util, json, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("auditc", os.path.join(BASE, "scripts", "audit-completeness.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

paths = sys.argv[1:]
out = {}
for p in paths:
    full = p if os.path.isabs(p) else os.path.join(BASE, p)
    out[os.path.basename(full)] = mod.audit(full)
print(json.dumps(out, ensure_ascii=False, indent=1))

