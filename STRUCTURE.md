# JossDraws Project Structure

## Folder Organization

```
JossDraws(beta)/
├── .git/                          # Git repository
├── .gitignore                     # Git ignore rules
├── docs/                          # PRODUCTION FILES
│   ├── css/                       # Production styles
│   ├── js/                        # Production scripts
│   ├── index.html
│   ├── review.html
│   ├── mgmt-7f8a2d9e.html
│   └── robots.txt
│
├── src/                           # DEVELOPMENT FILES (working directory)
│   ├── .gitignore
│   ├── css/                       # Dev styles (synced to docs/)
│   ├── js/                        # Dev scripts (synced to docs/)
│   ├── media/                     # Dev assets
│   ├── index.html
│   ├── review.html
│   └── other files
│
└── merge-to-main.ps1              # Helper script (not committed)
```

## Git Branches

- **main** → Production (tracked by docs/)
- **dev** → Development (tracked by src/)

## Workflow for Pushing to Main

### 1. Work on Development
```powershell
# Make sure you're on dev branch
git checkout dev

# Make changes in src/ folder
# Edit: src/js/click-spark.js, etc.
```

### 2. Sync and Commit
```powershell
./scripts/sync-src-to-docs.ps1

# Commit changes
git add -A
git commit -m "Your descriptive message" 

```

### 3. Push to Main
```powershell
# Push dev branch → main branch
git push origin dev:main

# Verify push was successful - check GitHub
```

### 4. Sync Main Back to Dev (Poke-Yoke)
```powershell
# Always pull main back after pushing (ensures sync)
git fetch
git pull origin main

# Verify docs/ and src/ are in sync (run verification)
```

## Key Rules (Poke-Yoke) ✅

✅ **ALWAYS:**
- Keep src/ as your working directory
- Keep docs/ in sync with git branch before pushing
- Pull main back to dev after pushing
- Commit before pushing

❌ **NEVER:**
- Work directly in docs/ folder (it's for syncing only)
- Push without ensuring src/ and docs/ match
- Merge main → dev & dev → main in same session
- Create conflicting folder names

## Quick Commands

```powershell
# Show current branch
git branch -a

# Show what's different
git diff main

# Check status
git status

# Undo uncommitted changes
git checkout -- .

# Safe sync check (no changes applied)
git diff src/ docs/
```

## Folder Sync Verification

To verify src/ and docs/ are in sync:

```powershell
# Compare all files
git diff src/ docs/

# If empty = they match ✓
# If shows differences = need to sync!
```

## Future Improvements

- [ ] Create automation script for src/ → docs/ sync
- [ ] Add pre-push hook to verify sync status
- [ ] Add file-watching to auto-update docs/ when src/ changes
- [ ] Create deploy script for docs/ → main

---

**Last Updated:** 2026-02-09  
**Structure Version:** 1.0
