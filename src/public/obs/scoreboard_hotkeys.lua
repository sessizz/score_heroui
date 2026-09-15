obs = obslua

-- ============================================================================
-- Voleybol Skorboard - OBS Canli Yayin Kisayol Eklentisi (Lua)
-- ============================================================================

local server_url = "http://localhost:3000"
local board_id = "fenerbahce"
local last_status_text = "Hazir (Kisayol tuslari bekleniyor)"

-- Kisayollar ve API eylem eslestirmeleri
local hotkey_defs = {
    { name = "score_point_a",          desc = "[Skorboard] Takim A: +1 Sayi",          action = "point_a" },
    { name = "score_sub_point_a",      desc = "[Skorboard] Takim A: -1 Sayi (Geri Al)", action = "sub_point_a" },
    { name = "score_point_b",          desc = "[Skorboard] Takim B: +1 Sayi",          action = "point_b" },
    { name = "score_sub_point_b",      desc = "[Skorboard] Takim B: -1 Sayi (Geri Al)", action = "sub_point_b" },
    { name = "score_toggle_serve",     desc = "[Skorboard] Servis Degistir (Siradaki)", action = "toggle_serve" },
    { name = "score_serve_a",          desc = "[Skorboard] Servis: Takim A",           action = "serve_a" },
    { name = "score_serve_b",          desc = "[Skorboard] Servis: Takim B",           action = "serve_b" },
    { name = "score_toggle_timeout_a", desc = "[Skorboard] Takim A: Mola (Ac / Kapat)", action = "toggle_timeout_a" },
    { name = "score_toggle_timeout_b", desc = "[Skorboard] Takim B: Mola (Ac / Kapat)", action = "toggle_timeout_b" },
    { name = "score_end_timeout",      desc = "[Skorboard] Molayi Bitir",              action = "end_timeout" },
    { name = "score_undo",             desc = "[Skorboard] Son Islemi Geri Al (Undo)", action = "undo" },
    { name = "score_swap_sides",       desc = "[Skorboard] Saha Degistir (Taraf)",     action = "swap_sides" },
    { name = "score_clock_toggle",     desc = "[Skorboard] Sure Baslat / Durdur",      action = "clock_toggle" },
    { name = "score_end_set",          desc = "[Skorboard] Seti Bitir",                action = "end_set" }
}

local hotkey_ids = {}
local is_windows = package.config:sub(1,1) == '\\'
local vbs_helper_path = nil

-- Windows Win32 API yukleyicisi (Siyah CMD konsol penceresini %100 onler)
local ffi_ok, ffi = pcall(require, "ffi")
if ffi_ok and ffi and is_windows then
    pcall(function()
        ffi.cdef[[
            unsigned int WinExec(const char *lpCmdLine, unsigned int uCmdShow);
        ]]
    end)
end

-- Windows'ta siyah konsol penceresinin acilmasini onleyen VBS olusturucu (FFI yoksa yedek)
local function ensure_vbs_helper()
    if not is_windows then return nil end
    if vbs_helper_path then return vbs_helper_path end

    local s_path = script_path()
    local dir = ""
    if s_path then
        dir = s_path:match("(.*[/\\])") or ""
    end
    local target = dir .. "run_silent.vbs"

    local f = io.open(target, "r")
    if not f then
        f = io.open(target, "w")
        if f then
            f:write('Set WshShell = CreateObject("WScript.Shell")\n')
            f:write('If WScript.Arguments.Count > 0 Then\n')
            f:write('    WshShell.Run WScript.Arguments(0), 0, False\n')
            f:write('End If\n')
            f:close()
        end
    else
        f:close()
    end
    vbs_helper_path = target
    return vbs_helper_path
end

-- Skorboard sunucusuna HTTP istegi gonder
function send_action(action)
    local clean_url = server_url:gsub("/+$", "")
    local clean_board = board_id:gsub("^%s*(.-)%s*$", "%1")
    local url = clean_url .. "/api/board/" .. clean_board .. "/action/" .. action

    obs.script_log(obs.LOG_INFO, "[Skorboard] Eylem: " .. action .. " -> " .. url)
    last_status_text = "Son Eylem: " .. action .. " (" .. os.date("%H:%M:%S") .. ")"

    if is_windows then
        -- 1. Win32 WinExec API: Sifir CMD penceresi, tamamen gorunmez calisir
        if ffi_ok and ffi and ffi.C and ffi.C.WinExec then
            local curl_cmd = 'curl.exe -s -m 2 -X POST "' .. url .. '"'
            ffi.C.WinExec(curl_cmd, 0)
            return
        end

        -- 2. Yedek: VBS uzerinden SW_HIDE
        local vbs = ensure_vbs_helper()
        if vbs then
            local curl_cmd = 'curl.exe -s -m 2 -X POST "' .. url .. '"'
            local run_cmd = 'wscript.exe //nologo "' .. vbs .. '" "' .. curl_cmd .. '"'
            os.execute(run_cmd)
        else
            os.execute('start /B "" curl.exe -s -m 2 -X POST "' .. url .. '"')
        end
    else
        os.execute('curl -s -m 2 -X POST "' .. url .. '" &')
    end
end

-- OBS Komut Dosyasi Aciklamasi
function script_description()
    return [[
<h2>🏐 Voleybol Skorboard Kisayol Eklentisi</h2>
<p>Canli yayindayken klavye veya harici kumandanizdan (Stream Deck, NumPad, F tuslari) tek tusla skor, servis ve mola yonetimi saglar.</p>
<b>Kurulum ve Kullanim:</b>
<ol>
  <li>Asagidan <b>Sunucu Adresi</b> ve <b>Skorboard Kodu</b> bilginizi girin.</li>
  <li>OBS menusunden <b>Ayarlar &rarr; Kisayollar</b> sekmesine gidin.</li>
  <li><code>[Skorboard]</code> ile baslayan kisayollara dilediginiz tuslari atayin.</li>
</ol>
]]
end

-- OBS Script Ayar Alanlari
function script_properties()
    local props = obs.obs_properties_create()
    obs.obs_properties_add_text(props, "server_url", "🌐 Sunucu Adresi (URL):", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "board_id", "🔑 Skorboard Kodu / ID:", obs.OBS_TEXT_DEFAULT)

    obs.obs_properties_add_button(props, "test_conn_btn", "⚡ Test Et (A Takimina +1 Sayi Ver)", function(properties, property)
        send_action("point_a")
        return true
    end)

    obs.obs_properties_add_button(props, "test_undo_btn", "↩️ Geri Al (Undo Testi)", function(properties, property)
        send_action("undo")
        return true
    end)

    return props
end

-- Varsayilan Degerler
function script_defaults(settings)
    obs.obs_data_set_default_string(settings, "server_url", "http://localhost:3000")
    obs.obs_data_set_default_string(settings, "board_id", "fenerbahce")
end

-- Ayarlar Guncellendiginde
function script_update(settings)
    server_url = obs.obs_data_get_string(settings, "server_url")
    board_id = obs.obs_data_get_string(settings, "board_id")
    if server_url == "" then server_url = "http://localhost:3000" end
    if board_id == "" then board_id = "fenerbahce" end
    ensure_vbs_helper()
end

-- Script OBS'e Eklendiginde / Basladiginda
function script_load(settings)
    script_update(settings)
    ensure_vbs_helper()

    for _, item in ipairs(hotkey_defs) do
        local action_name = item.action
        local cb = function(pressed)
            if pressed then
                send_action(action_name)
            end
        end

        local hk_id = obs.obs_hotkey_register_frontend(item.name, item.desc, cb)
        hotkey_ids[item.name] = hk_id

        local saved_array = obs.obs_data_get_array(settings, item.name)
        obs.obs_hotkey_load(hk_id, saved_array)
        obs.obs_data_array_release(saved_array)
    end

    obs.script_log(obs.LOG_INFO, "[Skorboard] Eklenti yuklendi. Skorboard: " .. board_id .. " (" .. server_url .. ")")
end

-- Script Kaydedildiginde
function script_save(settings)
    for _, item in ipairs(hotkey_defs) do
        local hk_id = hotkey_ids[item.name]
        if hk_id then
            local save_array = obs.obs_hotkey_save(hk_id)
            obs.obs_data_set_array(settings, item.name, save_array)
            obs.obs_data_array_release(save_array)
        end
    end
end
