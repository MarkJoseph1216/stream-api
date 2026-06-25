@echo off
echo Setting up remotes...

call :add github https://github.com/vyla-entertainment/stream-api.git
call :add hf1 https://huggingface.co/spaces/MissouriMonster/vyla-v2
call :add hf2 https://huggingface.co/spaces/MissouriMonster/vyla-v4
call :add hf3 https://huggingface.co/spaces/MissouriMonster/movieslay

echo Pushing...
for %%R in (github hf1 hf2 hf3) do git push %%R main --force

echo Done!
exit /b

:add
git remote remove %1 2>nul
git remote add %1 %2
exit /b