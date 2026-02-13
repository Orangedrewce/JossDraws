# JossDraws (Beginner Guide)

## The Only Workflow You Need

```powershell
# 1) Work in dev
git checkout dev

# 2) Edit files in src/

# 3) Sync src -> docs
./scripts/sync-src-to-docs.ps1

# 4) Save changes
git add -A
git commit -m "Your message"

# 5) Publish to live site
git push origin dev:main

# 6) Pull main back to dev (keeps things in sync)
git fetch
git pull origin main #oh fuck go back git push origin dev:main --force
```

## If Push Is Rejected

```powershell
git fetch origin
git merge origin/main
git push origin dev:main
```

## Simple Rules

- Always edit in src/
- Never edit in docs/
- Always sync before pushing

---

## Folder Basics (Less Important)

```
docs/   = live site files (do not edit here)
src/    = your working files (edit here)
```

## Quick Checks (Less Important)

```powershell
git status
git diff src/ docs/
```

---

**Last Updated:** 2026-02-11
