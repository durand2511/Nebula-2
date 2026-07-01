<?php
/**
 * Plugin Name: Nebula Exporter
 * Description: Exporteert de volledige WordPress-site (alle wp-content bestanden + database + gerenderde preview) naar een Nebula-project. Browser-gestuurd met voortgangsbalk: honderden kleine stapjes i.p.v. één lange request, dus het kan niet meer time-outen.
 * Version: 2.3.0
 * Author: Nebula
 * License: MIT
 *
 * Werking: onder "Extra → Nebula Export" plak je de Nebula API-URL + token en klik je op Exporteren.
 * De browser stuurt de export aan via admin-ajax in kleine stappen (bestanden → database → preview →
 * afronden), met een voortgangsbalk en automatische retry. De serverstatus (welk bestand als volgende)
 * staat in een WordPress-optie, zodat elke stap kort is en de export nooit als één lange request hangt.
 */

if (!defined('ABSPATH')) {
    exit; // Nooit direct aanroepbaar.
}

class Nebula_Exporter {
    const OPT_KEY   = 'nebula_exporter_settings';
    const JOB_KEY   = 'nebula_export_job';        // kleine voortgangsstaat (optie, autoload no)
    const MANIFEST  = 'nebula_export_manifest';    // de bestandenlijst (transient)

    const FILES_PER_STEP = 150;       // bestanden per AJAX-stap (server doet bulk-inserts, dus mag groter)
    const STEP_BYTES     = 5000000;   // ~5 MB per AJAX-stap (base64 blaast binair ~33% op)
    const CHUNK_BYTES    = 2500000;   // grote bestanden/DB in stukken van ~2,5 MB
    const MAX_FILE_BYTES = 50000000;  // bestanden > 50 MB overslaan (backups/video's)

    public function __construct() {
        add_action('admin_menu', array($this, 'menu'));
        add_action('admin_init', array($this, 'register_settings'));
        add_action('wp_ajax_nebula_export_step', array($this, 'ajax_step'));
    }

    public function menu() {
        add_management_page('Nebula Export', 'Nebula Export', 'manage_options', 'nebula-export', array($this, 'render_page'));
    }

    public function register_settings() {
        register_setting(self::OPT_KEY, self::OPT_KEY, array($this, 'sanitize_settings'));
    }

    public function sanitize_settings($input) {
        return array(
            'api_url' => isset($input['api_url']) ? esc_url_raw(trim($input['api_url'])) : '',
            'token'   => isset($input['token']) ? sanitize_text_field(trim($input['token'])) : '',
        );
    }

    private function settings() {
        return wp_parse_args(get_option(self::OPT_KEY, array()), array('api_url' => '', 'token' => ''));
    }

    // ── Admin-pagina ─────────────────────────────────────────────────────────

    public function render_page() {
        if (!current_user_can('manage_options')) { return; }
        $s = $this->settings();
        $default_name = get_bloginfo('name') ? get_bloginfo('name') : wp_parse_url(home_url(), PHP_URL_HOST);
        $ready = !empty($s['api_url']) && !empty($s['token']);
        ?>
        <div class="wrap">
            <h1>Nebula Export</h1>
            <p>Exporteert de volledige WordPress-site (bestanden + database + preview) naar een nieuw Nebula-project.</p>

            <h2>Instellingen</h2>
            <form method="post" action="options.php">
                <?php settings_fields(self::OPT_KEY); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="nebula_api_url">Nebula API-URL</label></th>
                        <td><input name="<?php echo esc_attr(self::OPT_KEY); ?>[api_url]" id="nebula_api_url" type="url" class="regular-text"
                                   placeholder="https://www.nebulabookings.com" value="<?php echo esc_attr($s['api_url']); ?>" />
                            <p class="description">De basis-URL van je Nebula-server (zonder <code>/api</code>).</p></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="nebula_token">Nebula-token</label></th>
                        <td><input name="<?php echo esc_attr(self::OPT_KEY); ?>[token]" id="nebula_token" type="password" class="regular-text"
                                   autocomplete="off" value="<?php echo esc_attr($s['token']); ?>" />
                            <p class="description">Je Nebula-token (kopieer het uit het WordPress-paneel in Nebula).</p></td>
                    </tr>
                </table>
                <?php submit_button('Instellingen opslaan'); ?>
            </form>

            <hr />
            <h2>Exporteren</h2>
            <?php if (!$ready): ?>
                <p><strong>Vul eerst de API-URL en het token in en sla op.</strong></p>
            <?php else: ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="nebula_project_name">Projectnaam in Nebula</label></th>
                    <td><input id="nebula_project_name" type="text" class="regular-text" value="<?php echo esc_attr($default_name); ?>" /></td>
                </tr>
                <tr>
                    <th scope="row">Wat meesturen</th>
                    <td>
                        <label><input type="checkbox" id="nebula_inc_uploads" checked /> Uploads/media meenemen (kan groot zijn)</label><br />
                        <label><input type="checkbox" id="nebula_inc_db" checked /> Volledige database-dump</label>
                    </td>
                </tr>
            </table>

            <p><button type="button" class="button button-primary button-hero" id="nebula-export-btn">Exporteren naar Nebula</button></p>

            <div id="nebula-progress-wrap" style="display:none;max-width:720px;">
                <div style="background:#e2e4e7;border-radius:10px;overflow:hidden;height:26px;">
                    <div id="nebula-bar" style="width:0%;height:100%;background:#7a00df;color:#fff;font:600 13px/26px system-ui;text-align:center;transition:width .3s;">0%</div>
                </div>
                <p id="nebula-status" style="font-weight:600;margin:10px 0 4px;"></p>
                <pre id="nebula-log" style="background:#f6f7f7;border:1px solid #dcdcde;border-radius:8px;padding:10px;max-height:260px;overflow:auto;white-space:pre-wrap;font-size:12px;"></pre>
            </div>

            <script>
            (function(){
                var ajaxurl = <?php echo wp_json_encode(admin_url('admin-ajax.php')); ?>;
                var nonce   = <?php echo wp_json_encode(wp_create_nonce('nebula_export')); ?>;
                var btn=document.getElementById('nebula-export-btn');
                var wrap=document.getElementById('nebula-progress-wrap');
                var bar=document.getElementById('nebula-bar');
                var statusEl=document.getElementById('nebula-status');
                var logEl=document.getElementById('nebula-log');
                var running=false;

                function log(m){ logEl.textContent += m + "\n"; logEl.scrollTop=logEl.scrollHeight; }
                function setBar(p){ p=Math.max(0,Math.min(100,Math.round(p))); bar.style.width=p+'%'; bar.textContent=p+'%'; }

                function step(params, retries){
                    var body=new FormData();
                    body.append('action','nebula_export_step');
                    body.append('_ajax_nonce',nonce);
                    for(var k in params){ body.append(k, params[k]); }
                    return fetch(ajaxurl,{method:'POST',body:body,credentials:'same-origin'})
                        .then(function(r){ return r.json().catch(function(){ throw new Error('Ongeldig serverantwoord (HTTP '+r.status+').'); }); })
                        .then(function(j){
                            if(!j || !j.success){
                                var msg=(j&&j.data&&j.data.message)?j.data.message:'Onbekende fout';
                                if(retries>0){ log('⚠ '+msg+' — opnieuw proberen…'); return new Promise(function(res){setTimeout(res,2500);}).then(function(){ return step(params, retries-1); }); }
                                throw new Error(msg);
                            }
                            return j.data;
                        }, function(err){
                            if(retries>0){ log('⚠ Netwerkfout — opnieuw proberen…'); return new Promise(function(res){setTimeout(res,2500);}).then(function(){ return step(params, retries-1); }); }
                            throw err;
                        });
                }

                function loop(d){
                    setBar(d.percent||0);
                    statusEl.textContent=d.message||d.phase;
                    if(d.message){ log(d.message); }
                    if(d.finished){
                        setBar(100);
                        statusEl.textContent='✅ Klaar! '+d.sent+' items verzonden'+(d.skipped?(' ('+d.skipped+' overgeslagen)'):'')+'.';
                        log('Klaar. Ga terug naar Nebula en klik op "Verifieer de website".');
                        btn.disabled=false; running=false; return;
                    }
                    return step({},8).then(loop); // 8 retries per stap → transiënte hikjes overleven
                }
                function fail(e){
                    statusEl.textContent='❌ Gestopt: '+e.message;
                    log('Gestopt: '+e.message+'. Klik opnieuw op Exporteren om te HERVATTEN (hij begint niet overnieuw).');
                    btn.disabled=false; running=false;
                }
                function run(){
                    if(running){ return; } running=true; btn.disabled=true; wrap.style.display='block'; setBar(0);
                    statusEl.textContent='Controleren…';
                    // Eerst proben: staat er nog een export open? Zo ja → HERVATTEN i.p.v. overnieuw.
                    step({probe:1},3).then(function(p){
                        if(p && p.active){
                            if(window.confirm('Er staat nog een onafgeronde export open ('+(Math.round(p.percent)||0)+'%).\n\nOK = HERVATTEN waar hij gebleven was.\nAnnuleren = helemaal OPNIEUW beginnen (nieuw project).')){
                                log('▶ Hervatten op '+(Math.round(p.percent)||0)+'% …');
                                return step({},8).then(loop);
                            }
                        }
                        logEl.textContent='';
                        var cfg={ start:1,
                            project_name: document.getElementById('nebula_project_name').value,
                            include_uploads: document.getElementById('nebula_inc_uploads').checked?1:0,
                            include_db: document.getElementById('nebula_inc_db').checked?1:0 };
                        return step(cfg,3).then(loop);
                    }).catch(fail);
                }
                btn.addEventListener('click', run);
            })();
            </script>
            <?php endif; ?>
        </div>
        <?php
    }

    // ── AJAX-stap ─────────────────────────────────────────────────────────────

    public function ajax_step() {
        check_ajax_referer('nebula_export');
        if (!current_user_can('manage_options')) { wp_send_json_error(array('message' => 'Onvoldoende rechten.')); }
        @set_time_limit(120);
        @ini_set('memory_limit', '512M');

        $s = $this->settings();
        $api = rtrim($s['api_url'], '/'); $token = $s['token'];
        if (empty($api) || empty($token)) { wp_send_json_error(array('message' => 'API-URL of token ontbreekt.')); }

        // Probe: staat er nog een onafgeronde export open? (om te kunnen hervatten i.p.v. overnieuw)
        if (!empty($_POST['probe'])) {
            $job = get_option(self::JOB_KEY);
            if (is_array($job) && isset($job['phase']) && $job['phase'] !== 'done') {
                $p = $this->progress($job, 'Openstaande export gevonden.');
                $p['active'] = true;
                wp_send_json_success($p);
            }
            wp_send_json_success(array('active' => false));
        }

        // Start: nieuw project + bestandenlijst opbouwen.
        if (!empty($_POST['start'])) {
            $this->cleanup_job();
            $name = isset($_POST['project_name']) ? sanitize_text_field(wp_unslash($_POST['project_name'])) : get_bloginfo('name');
            $include_uploads = !empty($_POST['include_uploads']);
            $include_db      = !empty($_POST['include_db']);
            $init = $this->api_post($api, '/api/import/wordpress/init', $token, array('name' => $name, 'siteUrl' => home_url()));
            if (is_wp_error($init) || empty($init['projectId'])) {
                wp_send_json_error(array('message' => 'Aanmaken van project mislukt: ' . $this->err_text($init)));
            }
            $files = $this->build_file_list($include_uploads);
            set_transient(self::MANIFEST, $files, 24 * HOUR_IN_SECONDS);
            $job = array(
                'project_id' => intval($init['projectId']),
                'phase' => 'preview', 'cursor' => 0, 'total' => count($files), 'sent' => 0, 'skipped' => 0,
                'include_db' => $include_db,
                'db_started' => false, 'db_path' => '', 'db_size' => 0, 'db_offset' => 0,
                'prev_started' => false, 'prev_urls' => array(), 'prev_cursor' => 0,
            );
            update_option(self::JOB_KEY, $job, false);
            wp_send_json_success($this->progress($job, 'Project aangemaakt (id ' . $job['project_id'] . '). ' . count($files) . ' bestanden gevonden.'));
        }

        $job = get_option(self::JOB_KEY);
        if (!is_array($job)) { wp_send_json_error(array('message' => 'Geen actieve export. Klik opnieuw op Exporteren.')); }

        $result = true;
        try {
            switch ($job['phase']) {
                case 'files':    $result = $this->step_files($api, $token, $job); break;
                case 'db':       $result = $this->step_db($api, $token, $job); break;
                case 'preview':  $result = $this->step_preview($api, $token, $job); break;
                case 'finalize': $result = $this->step_finalize($api, $token, $job); break;
                default:         $job['phase'] = 'done';
            }
        } catch (Exception $e) {
            $result = new WP_Error('nebula_step', $e->getMessage());
        }

        // Bewaar de (mogelijk deels) gevorderde staat, zodat een retry vlot verder gaat.
        update_option(self::JOB_KEY, $job, false);

        if (is_wp_error($result)) {
            wp_send_json_error(array('message' => $result->get_error_message(), 'resumable' => true));
        }
        if ($job['phase'] === 'done') { $this->cleanup_job(); }
        wp_send_json_success($this->progress($job, isset($job['msg']) ? $job['msg'] : ''));
    }

    // ── Stappen ───────────────────────────────────────────────────────────────

    private function step_files($api, $token, &$job) {
        $files = get_transient(self::MANIFEST);
        if (!is_array($files)) { $job['phase'] = $job['include_db'] ? 'db' : 'finalize'; $job['msg'] = 'Bestanden klaar.'; return true; }
        $root = untrailingslashit(ABSPATH);
        $pid  = $job['project_id'];
        $n = count($files); $i = $job['cursor'];
        $batch = array(); $bytes = 0; $skipped = 0;

        while ($i < $n) {
            $abs = $files[$i];
            $rel = $this->rel_path($abs, $root);
            if ($rel === null) { $i++; continue; }
            $size = @filesize($abs);
            if ($size === false || $size > self::MAX_FILE_BYTES) { $i++; $skipped++; continue; }

            if ($size > self::CHUNK_BYTES) {
                if (!empty($batch)) { break; } // grote file in eigen stap; huidige batch eerst flushen (hieronder)
                $raw = @file_get_contents($abs);
                if ($raw === false) { $i++; $skipped++; continue; }
                $r = $this->send_big_file($api, $token, $pid, $rel, $raw, $this->is_binary($abs, $raw));
                if (is_wp_error($r)) { return $r; } // cursor onveranderd → retry herhaalt deze file schoon
                $job['sent']++; $i++;
                $job['cursor'] = $i; $job['skipped'] += $skipped;
                $job['msg'] = "Bestanden: {$job['sent']} / {$job['total']}";
                return true;
            }

            $raw = @file_get_contents($abs);
            if ($raw === false) { $i++; $skipped++; continue; }
            $binary = $this->is_binary($abs, $raw);
            if ($rel === 'wp-config.php') { $raw = $this->sanitize_wp_config($raw); }
            $part = array('path' => $rel, 'content' => $binary ? base64_encode($raw) : $raw, 'encoding' => $binary ? 'base64' : 'utf8');
            $batch[] = $part; $bytes += strlen($part['content']); $i++;
            if (count($batch) >= self::FILES_PER_STEP || $bytes >= self::STEP_BYTES) { break; }
        }

        if (!empty($batch)) {
            $r = $this->api_post($api, '/api/import/wordpress/files', $token, array('projectId' => $pid, 'files' => $batch));
            if (is_wp_error($r)) { return $r; } // cursor onveranderd → retry stuurt dezelfde batch opnieuw (idempotent)
            $job['sent'] += count($batch);
        }
        $job['cursor'] = $i; $job['skipped'] += $skipped;
        if ($i >= $n) { $job['phase'] = $job['include_db'] ? 'db' : 'finalize'; }
        $job['msg'] = "Bestanden: {$job['sent']} / {$job['total']}";
        return true;
    }

    private function step_db($api, $token, &$job) {
        if (!$job['db_started']) {
            $sql = $this->dump_database();
            $tmp = wp_tempnam('nebula-db');
            if (!$tmp || file_put_contents($tmp, $sql) === false) {
                $job['phase'] = 'finalize'; $job['msg'] = 'Database overgeslagen (kon tijdelijk bestand niet schrijven).'; return true;
            }
            $job['db_started'] = true; $job['db_path'] = $tmp; $job['db_size'] = strlen($sql); $job['db_offset'] = 0;
            unset($sql);
        }
        $size = $job['db_size'];
        if ($size == 0 || empty($job['db_path']) || !file_exists($job['db_path'])) { $job['phase'] = 'finalize'; $job['msg'] = 'Database klaar.'; return true; }

        $off = $job['db_offset'];
        $fh = fopen($job['db_path'], 'rb');
        fseek($fh, $off);
        $chunk = fread($fh, self::CHUNK_BYTES);
        // Uitlijnen op een newline zodat we geen SQL-regel of multibyte-teken doormidden knippen.
        if (!feof($fh)) { $rest = stream_get_line($fh, 20 * 1024 * 1024, "\n"); $chunk .= $rest . "\n"; }
        $new_off = ftell($fh);
        fclose($fh);

        $r = $this->api_post($api, '/api/import/wordpress/files', $token, array('projectId' => $job['project_id'],
            'files' => array(array('path' => 'wordpress-database.sql', 'content' => $chunk, 'encoding' => 'utf8', 'append' => ($off > 0)))));
        if (is_wp_error($r)) { return $r; }

        $job['db_offset'] = $new_off;
        if ($new_off >= $size) { @unlink($job['db_path']); $job['db_path'] = ''; $job['phase'] = 'finalize'; $job['msg'] = 'Database verzonden (' . size_format($size) . ').'; }
        else { $job['msg'] = 'Database versturen… ' . size_format($new_off) . ' / ' . size_format($size); }
        return true;
    }

    private function step_preview($api, $token, &$job) {
        if (!$job['prev_started']) {
            $urls = array(home_url('/'));
            $posts = get_pages(array('post_status' => 'publish', 'number' => 10));
            if (is_array($posts)) { foreach ($posts as $p) { $u = get_permalink($p->ID); if ($u) { $urls[] = $u; } } }
            $job['prev_urls'] = array_values(array_unique($urls)); $job['prev_cursor'] = 0; $job['prev_started'] = true;
        }
        $urls = $job['prev_urls']; $c = $job['prev_cursor']; $n = count($urls);
        if ($c >= $n) { $job['phase'] = 'files'; $job['msg'] = 'Preview klaar.'; return true; }

        $html = $this->fetch_rendered($urls[$c]);
        if ($html !== null) {
            $path = ($c === 0) ? 'index.html' : ($this->slug_from_url($urls[$c]) . '.html');
            $r = $this->api_post($api, '/api/import/wordpress/files', $token, array('projectId' => $job['project_id'],
                'files' => array(array('path' => $path, 'content' => $html, 'encoding' => 'utf8'))));
            if (is_wp_error($r)) { return $r; }
            $job['sent']++;
        }
        $job['prev_cursor'] = $c + 1;
        if ($job['prev_cursor'] >= $n) { $job['phase'] = 'files'; }
        $job['msg'] = 'Preview ophalen… ' . $job['prev_cursor'] . ' / ' . $n;
        return true;
    }

    private function step_finalize($api, $token, &$job) {
        $this->api_post($api, '/api/import/wordpress/finalize', $token, array('projectId' => $job['project_id']));
        $job['phase'] = 'done';
        $job['msg'] = 'Afgerond.';
        return true;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function progress($job, $msg) {
        $pct = 0;
        // Volgorde: preview (eerst, klein) → bestanden (bulk) → database → afronden.
        if ($job['phase'] === 'preview')     { $pct = 5; }
        elseif ($job['phase'] === 'files')   { $pct = ($job['total'] > 0) ? 8 + ($job['sent'] / max(1, $job['total'])) * 80 : 8; }
        elseif ($job['phase'] === 'db')      { $pct = 90; }
        elseif ($job['phase'] === 'finalize'){ $pct = 97; }
        elseif ($job['phase'] === 'done')    { $pct = 100; }
        return array(
            'phase' => $job['phase'],
            'finished' => ($job['phase'] === 'done'),
            'percent' => $pct,
            'sent' => $job['sent'], 'total' => $job['total'], 'skipped' => $job['skipped'],
            'project_id' => $job['project_id'],
            'message' => $msg !== '' ? $msg : (isset($job['msg']) ? $job['msg'] : ''),
        );
    }

    private function cleanup_job() {
        $job = get_option(self::JOB_KEY);
        if (is_array($job) && !empty($job['db_path']) && file_exists($job['db_path'])) { @unlink($job['db_path']); }
        delete_option(self::JOB_KEY);
        delete_transient(self::MANIFEST);
    }

    private function build_file_list($include_uploads) {
        $root = untrailingslashit(ABSPATH);
        $uploads = wp_get_upload_dir();
        $ubase = isset($uploads['basedir']) ? untrailingslashit($uploads['basedir']) : '';
        $targets = array();
        $wpc = untrailingslashit(WP_CONTENT_DIR);
        if (is_dir($wpc)) { $targets[] = $wpc; }
        foreach (glob($root . '/*.php') as $f) { $targets[] = $f; }
        foreach (array('.htaccess', 'robots.txt') as $x) { if (file_exists($root . '/' . $x)) { $targets[] = $root . '/' . $x; } }

        $out = array();
        foreach ($targets as $t) {
            $files = is_dir($t) ? $this->iterate_dir($t) : array($t);
            foreach ($files as $abs) {
                if (!$include_uploads && $ubase && strpos($abs, $ubase) === 0) { continue; }
                $rel = $this->rel_path($abs, $root);
                if ($rel === null) { continue; }
                if ($this->is_excluded($rel)) { continue; }
                $out[] = $abs;
            }
        }
        return $out;
    }

    private function iterate_dir($dir) {
        $out = array();
        try {
            $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::LEAVES_ONLY);
            foreach ($it as $file) { if ($file->isFile()) { $out[] = $file->getPathname(); } }
        } catch (Exception $e) { /* onleesbare map — negeren */ }
        return $out;
    }

    private function rel_path($abs, $root) {
        $abs = str_replace('\\', '/', $abs); $root = str_replace('\\', '/', $root);
        if (strpos($abs, $root) !== 0) { return null; }
        $rel = ltrim(substr($abs, strlen($root)), '/');
        return $rel !== '' ? $rel : null;
    }

    private function slug_from_url($url) {
        $p = trim((string) wp_parse_url($url, PHP_URL_PATH), '/');
        $p = preg_replace('#\.(html?|php)$#i', '', $p);
        $slug = sanitize_title(basename($p));
        return $slug ? $slug : 'pagina';
    }

    private function is_binary($path, $content) {
        // NUL-byte vooraan → altijd binair (ook bij 'tekst'-extensie): Wordfence-logs / object-cache.php
        // hebben binaire data ná __halt_compiler(); Postgres kan die NUL-bytes niet als tekst opslaan.
        if (strpos(substr($content, 0, 16384), "\0") !== false) { return true; }
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $text_ext = array('php','html','htm','css','scss','js','mjs','cjs','json','svg','ts','tsx','jsx','md','txt','xml','yml','yaml','sql','ini','csv','po','pot','htaccess','conf','map');
        return !in_array($ext, $text_ext, true);
    }

    private function is_excluded($rel) {
        $rel = strtolower($rel);
        $dirs = array(
            'wp-content/cache/', 'wp-content/wflogs/', 'wp-content/upgrade/', 'wp-content/uploads/cache/',
            'wp-content/ai1wm-backups/', 'wp-content/updraft/', 'wp-content/backups-dup-lite/',
            'wp-content/uploads/backupbuddy_backups/', 'wp-content/uploads/wp-migrate-db/', '.git/', 'node_modules/',
        );
        foreach ($dirs as $d) { if (strpos($rel, $d) !== false) { return true; } }
        if (strpos($rel, 'object-cache.php') !== false || strpos($rel, 'advanced-cache.php') !== false) { return true; }
        if (preg_match('#(^|/)backup[^/]*$#', $rel)) { return true; }
        if (preg_match('#\.(zip|tar|gz|tgz|bz2|log)$#', $rel)) { return true; }
        return false;
    }

    private function sanitize_wp_config($content) {
        $keys = array('DB_PASSWORD', 'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY',
                      'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT');
        foreach ($keys as $k) {
            $content = preg_replace("/(define\\(\\s*['\"]" . preg_quote($k, '/') . "['\"]\\s*,\\s*)(['\"]).*?(['\"])/s", "$1$2***VERWIJDERD***$3", $content);
        }
        return $content;
    }

    // Eén (mogelijk groot) bestand in chunks: eerste part vervangt, rest append't.
    private function send_big_file($api, $token, $project_id, $rel, $raw, $binary) {
        $encoded = $binary ? base64_encode($raw) : $raw;
        $len = strlen($encoded); $offset = 0; $first = true;
        while ($offset < $len || $first) {
            $slice = substr($encoded, $offset, self::CHUNK_BYTES);
            $offset += strlen($slice);
            $r = $this->api_post($api, '/api/import/wordpress/files', $token, array('projectId' => $project_id,
                'files' => array(array('path' => $rel, 'content' => $slice, 'encoding' => $binary ? 'base64' : 'utf8', 'append' => !$first))));
            if (is_wp_error($r)) { return $r; }
            $first = false;
            if ($slice === '') { break; }
        }
        return true;
    }

    // ── Database-dump (puur PHP via $wpdb) ─────────────────────────────────────

    private function dump_database() {
        global $wpdb;
        $out  = "-- Nebula WordPress database dump\n-- Site: " . home_url() . "\n-- Datum: " . gmdate('Y-m-d H:i:s') . " UTC\n\n";
        $out .= "SET FOREIGN_KEY_CHECKS=0;\n\n";
        $tables = $wpdb->get_col('SHOW TABLES');
        foreach ($tables as $table) {
            $create = $wpdb->get_row("SHOW CREATE TABLE `$table`", ARRAY_N);
            if (!$create || !isset($create[1])) { continue; }
            $out .= "-- Tabel: $table\nDROP TABLE IF EXISTS `$table`;\n" . $create[1] . ";\n\n";
            $rows = $wpdb->get_results("SELECT * FROM `$table`", ARRAY_A);
            if (empty($rows)) { continue; }
            $cols = array_keys($rows[0]);
            $col_list = '`' . implode('`, `', $cols) . '`';
            foreach (array_chunk($rows, 200) as $chunk) {
                $values = array();
                foreach ($chunk as $row) {
                    $vals = array();
                    foreach ($cols as $c) { $v = $row[$c]; $vals[] = is_null($v) ? 'NULL' : "'" . esc_sql($v) . "'"; }
                    $values[] = '(' . implode(', ', $vals) . ')';
                }
                $out .= "INSERT INTO `$table` ($col_list) VALUES\n" . implode(",\n", $values) . ";\n";
            }
            $out .= "\n";
        }
        $out .= "SET FOREIGN_KEY_CHECKS=1;\n";
        return $out;
    }

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

    private function fetch_rendered($url) {
        $body = $this->fetch_body($url, 15);
        if ($body === null) { return null; }
        return $this->inline_css($body); // CSS inbedden zodat de preview gestyled is zonder externe proxy
    }

    private function fetch_body($url, $timeout = 10) {
        $resp = wp_remote_get($url, array(
            'timeout' => $timeout, 'redirection' => 2, 'sslverify' => false,
            'user-agent' => self::UA, // browser-UA → Wordfence/SiteGround blokkeert de fetch niet met 403
            'headers'    => array('Accept' => '*/*'),
        ));
        if (is_wp_error($resp)) { return null; }
        $code = wp_remote_retrieve_response_code($resp);
        if ($code < 200 || $code >= 300) { return null; }
        $b = wp_remote_retrieve_body($resp);
        return (is_string($b) && $b !== '') ? $b : null;
    }

    // Vervang <link rel="stylesheet"> door <style>…</style> met de opgehaalde CSS. Nebula's server
    // kan je (beschermde) site niet bereiken om de CSS te proxyen; door 'm hier in te bedden is de
    // preview tóch gestyled. Budget-begrensd zodat de pagina niet gigantisch wordt.
    private function inline_css($html) {
        if (stripos($html, '<link') === false) { return $html; }
        $budget = 900000; // ~900 KB max aan ingebedde CSS
        return preg_replace_callback('#<link\b[^>]*>#i', function ($m) use (&$budget) {
            $tag = $m[0];
            if (!preg_match('#rel=["\']?stylesheet#i', $tag)) { return $tag; }
            if ($budget <= 0 || !preg_match('#href=["\']([^"\']+)["\']#i', $tag, $h)) { return $tag; }
            $url = html_entity_decode($h[1]);
            if (strpos($url, '//') === 0) { $url = 'https:' . $url; }
            elseif (strpos($url, 'http') !== 0) { $url = home_url('/') . ltrim($url, '/'); }
            $css = $this->fetch_body($url, 10);
            if ($css === null || strlen($css) > $budget) { return $tag; }
            $budget -= strlen($css);
            return '<style>' . $css . '</style>';
        }, $html);
    }

    // ── HTTP-helper (volgt redirects zelf + retry op transiënte fouten) ────────

    private function api_post($api, $path, $token, $body) {
        $url_orig = $api . $path;
        $json = wp_json_encode($body);
        $args = array(
            'timeout' => 120, 'redirection' => 0,
            'headers' => array('Content-Type' => 'application/json', 'Authorization' => 'Bearer ' . $token),
            'body' => $json,
        );
        $transient = array(408, 425, 429, 500, 502, 503, 504);
        $last_err = 'onbekende fout';

        for ($attempt = 0; $attempt < 4; $attempt++) {
            $url = $url_orig; $response = null;
            for ($hop = 0; $hop < 5; $hop++) {
                $response = wp_remote_post($url, $args);
                if (is_wp_error($response)) { break; }
                $code = wp_remote_retrieve_response_code($response);
                if (in_array($code, array(301, 302, 303, 307, 308), true)) {
                    $loc = wp_remote_retrieve_header($response, 'location');
                    if (empty($loc)) { break; }
                    if (strpos($loc, 'http://') !== 0 && strpos($loc, 'https://') !== 0) {
                        $p = wp_parse_url($url);
                        $loc = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '') . '/' . ltrim($loc, '/');
                    }
                    $url = $loc; continue;
                }
                break;
            }
            if (is_wp_error($response)) {
                $last_err = $response->get_error_message();
            } else {
                $code = wp_remote_retrieve_response_code($response);
                if (!in_array($code, $transient, true)) {
                    $data = json_decode(wp_remote_retrieve_body($response), true);
                    if ($code < 200 || $code >= 300) {
                        $msg = is_array($data) && isset($data['error']) ? $data['error'] : ('HTTP ' . $code . ' bij ' . $url);
                        return new WP_Error('nebula_http', $msg);
                    }
                    return is_array($data) ? $data : array();
                }
                $last_err = 'HTTP ' . $code . ' bij ' . $url;
            }
            if ($attempt < 3) { sleep(2 * ($attempt + 1)); }
        }
        return new WP_Error('nebula_http', $last_err . ' (na 4 pogingen)');
    }

    private function err_text($maybe_error) {
        return is_wp_error($maybe_error) ? $maybe_error->get_error_message() : 'onbekende fout';
    }
}

new Nebula_Exporter();
