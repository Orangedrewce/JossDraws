# Clean up any stuck merge state
Remove-Item ".git/MERGE_MSG" -ErrorAction SilentlyContinue
Remove-Item ".git/MERGE_HEAD" -ErrorAction SilentlyContinue  
Remove-Item ".git/MERGE_MODE" -ErrorAction SilentlyContinue
Remove-Item ".git/AUTO_MERGE" -ErrorAction SilentlyContinue
Remove-Item ".git/.MERGE_MSG.sw*" -ErrorAction SilentlyContinue

# Stage and commit changes
$env:GIT_EDITOR = 'notepad'  # Use notepad instead of vim
git add -A
git commit -m "Remove redundant loading message - CSS spinner handles visual feedback"

# Merge to main and push
git checkout main
git merge dev
git push origin main

# Return to dev
git checkout dev

Write-Host "Merge complete! You're now on the dev branch."
