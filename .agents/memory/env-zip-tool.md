---
name: zip CLI wrapper is broken in this environment
description: The shell `zip` command cannot create archives; use python3 zipfile.
---
The `zip` command in this sandbox is a wrapper that fails with `Failed to add file ... open ...: no such file or directory` regardless of relative/absolute output path or quoting. It does NOT create the archive.

**Workaround:** build archives with Python's stdlib:
```python
import zipfile, os
skip={'node_modules','dist','.astro'}
with zipfile.ZipFile(OUT,'w',zipfile.ZIP_DEFLATED) as z:
    for dp,dn,fn in os.walk('.'):
        if any(p in skip for p in dp.split(os.sep)): continue
        for f in fn:
            full=os.path.join(dp,f); z.write(full, os.path.join('rootname', os.path.relpath(full,'.')))
```
Failed `zip` attempts can also leave stray files like `-rq`; clean with `rm -f -- -rq`.
