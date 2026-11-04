@echo off
rem Bardurinho RPG - sobe o teste externo (Fase 7) num endereco so. Ver docs\fase-07.md.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js nao encontrado: instale o Node 22+ em https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Instalando dependencias...
  call npm install || (pause & exit /b 1)
)
if not exist .env (
  copy .env.example .env >nul
  echo Criado .env a partir de .env.example - troque o ADMIN_TOKEN.
)
call npm run start:prod
pause
