import obspython as obs
import urllib.request
import threading

# ============================================================================
# Voleybol Skorboard - OBS Canli Yayin Kisayol Eklentisi (Python)
# ============================================================================

server_url = "http://localhost:3000"
board_id = "fenerbahce"

HOTKEYS = [
    ("score_py_point_a", "[Skorboard] Takim A: +1 Sayi", "point_a"),
    ("score_py_sub_point_a", "[Skorboard] Takim A: -1 Sayi (Geri Al)", "sub_point_a"),
    ("score_py_point_b", "[Skorboard] Takim B: +1 Sayi", "point_b"),
    ("score_py_sub_point_b", "[Skorboard] Takim B: -1 Sayi (Geri Al)", "sub_point_b"),
    ("score_py_toggle_serve", "[Skorboard] Servis Degistir (Siradaki)", "toggle_serve"),
    ("score_py_serve_a", "[Skorboard] Servis: Takim A", "serve_a"),
    ("score_py_serve_b", "[Skorboard] Servis: Takim B", "serve_b"),
    ("score_py_toggle_timeout_a", "[Skorboard] Takim A: Mola (Ac / Kapat)", "toggle_timeout_a"),
    ("score_py_toggle_timeout_b", "[Skorboard] Takim B: Mola (Ac / Kapat)", "toggle_timeout_b"),
    ("score_py_end_timeout", "[Skorboard] Molayi Bitir", "end_timeout"),
    ("score_py_undo", "[Skorboard] Son Islemi Geri Al (Undo)", "undo"),
    ("score_py_swap_sides", "[Skorboard] Saha Degistir (Taraf)", "swap_sides"),
    ("score_py_clock_toggle", "[Skorboard] Sure Baslat / Durdur", "clock_toggle"),
    ("score_py_end_set", "[Skorboard] Seti Bitir", "end_set"),
]

hotkey_ids = {}

def send_action(action):
    def _worker():
        try:
            clean_url = server_url.rstrip("/")
            clean_board = board_id.strip()
            url = f"{clean_url}/api/board/{clean_board}/action/{action}"
            req = urllib.request.Request(url, method="POST", headers={"User-Agent": "OBS-Scoreboard-Script/1.0"})
            with urllib.request.urlopen(req, timeout=2.5) as resp:
                pass
            print(f"[Skorboard] Eylem iletildi: {action}")
        except Exception as e:
            print(f"[Skorboard] Eylem hatasi ({action}): {e}")

    threading.Thread(target=_worker, daemon=True).start()

def script_description():
    return """
<h2>🏐 Voleybol Skorboard Kısayol Eklentisi (Python)</h2>
<p>OBS canlı yayındayken klavye veya harici aygıt kısayollarınızla skor, servis ve molaları yönetmenizi sağlar.</p>
<b>Kurulum:</b>
<ol>
  <li>Aşağıdan <b>Sunucu Adresi</b> ve <b>Skorboard Kodu</b> bilginizi girin.</li>
  <li>OBS <b>Ayarlar &rarr; Kısayollar</b> sekmesine gidin.</li>
  <li><code>[Skorboard]</code> kısayollarına istediğiniz tuşları (NumPad, F tuşları) atayın.</li>
</ol>
"""

def script_properties():
    props = obs.obs_properties_create()
    obs.obs_properties_add_text(props, "server_url", "🌐 Sunucu Adresi (URL):", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "board_id", "🔑 Skorboard Kodu / ID:", obs.OBS_TEXT_DEFAULT)

    obs.obs_properties_add_button(props, "test_conn_btn", "⚡ Test Et (A Takımına +1 Sayı Ver)", lambda p, prop: send_action("point_a") or True)
    obs.obs_properties_add_button(props, "test_undo_btn", "↩️ Geri Al (Undo)", lambda p, prop: send_action("undo") or True)
    return props

def script_defaults(settings):
    obs.obs_data_set_default_string(settings, "server_url", "http://localhost:3000")
    obs.obs_data_set_default_string(settings, "board_id", "fenerbahce")

def script_update(settings):
    global server_url, board_id
    server_url = obs.obs_data_get_string(settings, "server_url") or "http://localhost:3000"
    board_id = obs.obs_data_get_string(settings, "board_id") or "fenerbahce"

def script_load(settings):
    script_update(settings)
    for name, desc, action in HOTKEYS:
        def make_callback(act):
            return lambda pressed: send_action(act) if pressed else None

        hk_id = obs.obs_hotkey_register_frontend(name, desc, make_callback(action))
        hotkey_ids[name] = hk_id
        saved_array = obs.obs_data_get_array(settings, name)
        obs.obs_hotkey_load(hk_id, saved_array)
        obs.obs_data_array_release(saved_array)

    print(f"[Skorboard] Python eklentisi yuklendi. Skorboard: {board_id} ({server_url})")

def script_save(settings):
    for name, _, _ in HOTKEYS:
        hk_id = hotkey_ids.get(name)
        if hk_id:
            save_array = obs.obs_hotkey_save(hk_id)
            obs.obs_data_set_array(settings, name, save_array)
            obs.obs_data_array_release(save_array)
