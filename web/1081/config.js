// Адрес WS-сервера мини-аппы Маккода.
// Постоянный туннель: autossh с мак-мини на VPS Aeza-Helsinki (138.124.118.1),
// nginx на VPS терминирует TLS на :8443 и проксирует на localhost:8765 в SSH-туннеле.
// Управляется ~/Library/LaunchAgents/pro.kinemotor.maccode-tunnel.plist
window.MACCODE_WS_URL = "wss://138-124-118-1.sslip.io:8443/";
