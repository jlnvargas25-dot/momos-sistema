@echo off
echo ============================================
echo  Conectar Claude al MCP de Supabase
echo ============================================
echo.
set /p TOKEN=Pega tu token de Supabase (sbp_...) y presiona Enter:
echo.
claude mcp add supabase -s user -e SUPABASE_ACCESS_TOKEN=%TOKEN% -- cmd /c npx -y @supabase/mcp-server-supabase@latest
echo.
echo Si arriba dice "Added stdio MCP server supabase", ya esta.
echo Reinicia la sesion de Claude para que aparezcan las herramientas.
echo.
pause
