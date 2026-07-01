<?php
/**
 * Plugin Name: Nebula Exporter
 * Description: Exporteert de volledige WordPress-site (alle wp-content bestanden: thema's, plugins, uploads) plus een volledige database-dump en pusht alles naar een Nebula-project, zodat de complete code in Nebula beschikbaar is.
 * Version: 1.0.1
 * Author: Nebula
 * License: MIT
 *
 * Werking: onder "Extra → Nebula Export" plak je de Nebula API-URL + je Nebula-token, kies je wat je
 * meestuurt (bestanden / database), en klik je op Exporteren. De plugin maakt een nieuw Nebula-project
 * aan en stuurt daar in batches de bestanden + de SQL-dump naartoe (chunked, zodat grote sites niet op
 * een request-limiet stuiten). Bestanden worden gelezen t.o.v. de WordPress-root; binaire bestanden gaan
 * base64-gecodeerd, tekstbestanden als UTF-8.
 */

if (!defined('ABSPATH')) {
    exit; // Nooit direct aanroepbaar.
}

class Nebula_Exporter {
    const OPT_KEY   = 'nebula_exporter_settings';
    const NONCE     = 'nebula_exporter_run';
    // Houd elke request ruim onder de 60mb-limiet van het Nebula-endpoint (base64 blaast ~33% op).
    const BATCH_BYTES = 6000000;      // ~6 MB ruwe inhoud per batch
    const CHUNK_BYTES = 4000000;      // bestanden groter dan dit worden in stukken van ~4 MB gestuurd
    const MAX_FILE_BYTES = 80000000;  // bestanden groter dan 80 MB worden overgeslagen (te groot om zinvol op te slaan)

    public function __construct() {
        add_action('admin_menu', array($this, 'menu'));
        add_action('admin_post_nebula_export', array($this, 'handle_export'));
        add_action('admin_init', array($this, 'register_settings'));
    }

    public function menu() {
        add_management_page(
            'Nebula Export',
            'Nebula Export',
            'manage_options',
            'nebula-export',
            array($this, 'render_page')
        );
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
        $s = get_option(self::OPT_KEY, array());
        return wp_parse_args($s, array('api_url' => '', 'token' => ''));
    }

    public function render_page() {
        if (!current_user_can('manage_options')) {
            return;
        }
        $s = $this->settings();
        $default_name = get_bloginfo('name') ? get_bloginfo('name') : parse_url(home_url(), PHP_URL_HOST);
        ?>
        <div class="wrap">
            <h1>Nebula Export</h1>
            <p>Exporteert de volledige WordPress-site (bestanden + database) naar een nieuw Nebula-project.</p>

            <h2>Instellingen</h2>
            <form method="post" action="options.php">
                <?php settings_fields(self::OPT_KEY); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="nebula_api_url">Nebula API-URL</label></th>
                        <td>
                            <input name="<?php echo esc_attr(self::OPT_KEY); ?>[api_url]" id="nebula_api_url"
                                   type="url" class="regular-text" placeholder="https://jouw-nebula.onrender.com"
                                   value="<?php echo esc_attr($s['api_url']); ?>" />
                            <p class="description">De basis-URL van je Nebula-server (zonder <code>/api</code>).</p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="nebula_token">Nebula-token</label></th>
                        <td>
                            <input name="<?php echo esc_attr(self::OPT_KEY); ?>[token]" id="nebula_token"
                                   type="password" class="regular-text" autocomplete="off"
                                   value="<?php echo esc_attr($s['token']); ?>" />
                            <p class="description">Je Nebula-sessietoken (in de Nebula-console: localStorage-sleutel met je login-token).</p>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Instellingen opslaan'); ?>
            </form>

            <hr />

            <h2>Exporteren</h2>
            <?php if (empty($s['api_url']) || empty($s['token'])): ?>
                <p><strong>Vul eerst de API-URL en het token in en sla op.</strong></p>
            <?php else: ?>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="nebula_export" />
                <?php wp_nonce_field(self::NONCE); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="nebula_project_name">Projectnaam in Nebula</label></th>
                        <td><input name="project_name" id="nebula_project_name" type="text" class="regular-text"
                                   value="<?php echo esc_attr($default_name); ?>" /></td>
                    </tr>
                    <tr>
                        <th scope="row">Wat meesturen</th>
                        <td>
                            <label><input type="checkbox" name="include_files" value="1" checked /> Alle bestanden (wp-content: thema's, plugins, uploads + root PHP)</label><br />
                            <label><input type="checkbox" name="include_uploads" value="1" checked /> Uploads-map meenemen (media — kan groot zijn)</label><br />
                            <label><input type="checkbox" name="include_db" value="1" checked /> Volledige database-dump (<code>wordpress-database.sql</code>)</label>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Exporteren naar Nebula', 'primary', 'submit', true, array('onclick' => "return confirm('De export kan bij een grote site enkele minuten duren. Doorgaan?');")); ?>
            </form>
            <?php endif; ?>
        </div>
        <?php
    }

    public function handle_export() {
        if (!current_user_can('manage_options')) {
            wp_die('Onvoldoende rechten.');
        }
        check_admin_referer(self::NONCE);

        @set_time_limit(0);
        @ini_set('memory_limit', '512M');

        $s = $this->settings();
        $api = rtrim($s['api_url'], '/');
        $token = $s['token'];
        if (empty($api) || empty($token)) {
            $this->die_with_message('API-URL of token ontbreekt.');
        }

        $project_name    = isset($_POST['project_name']) ? sanitize_text_field(wp_unslash($_POST['project_name'])) : get_bloginfo('name');
        $include_files   = !empty($_POST['include_files']);
        $include_uploads = !empty($_POST['include_uploads']);
        $include_db      = !empty($_POST['include_db']);

        $log = array();

        // 1) Project aanmaken.
        $init = $this->api_post($api, '/api/import/wordpress/init', $token, array(
            'name'    => $project_name,
            'siteUrl' => home_url(),
        ));
        if (is_wp_error($init) || empty($init['projectId'])) {
            $this->die_with_message('Aanmaken van project mislukt: ' . $this->err_text($init));
        }
        $project_id = intval($init['projectId']);
        $log[] = "Project aangemaakt (id {$project_id}).";

        $total_files = 0;

        // 2) Bestanden.
        if ($include_files) {
            $result = $this->send_files($api, $token, $project_id, $include_uploads, $log);
            if (is_wp_error($result)) {
                $this->die_with_message('Verzenden van bestanden mislukt: ' . $result->get_error_message(), $log);
            }
            $total_files += $result;
            $log[] = "Bestanden verzonden: {$result}.";
        }

        // 3) Database-dump.
        if ($include_db) {
            $sql = $this->dump_database();
            $r = $this->send_big_file($api, $token, $project_id, 'wordpress-database.sql', $sql, false);
            if (is_wp_error($r)) {
                $this->die_with_message('Verzenden van database mislukt: ' . $r->get_error_message(), $log);
            }
            $log[] = 'Database-dump verzonden (wordpress-database.sql, ' . size_format(strlen($sql)) . ').';
            $total_files += 1;
        }

        // 4) Afronden.
        $fin = $this->api_post($api, '/api/import/wordpress/finalize', $token, array('projectId' => $project_id));
        $count = (!is_wp_error($fin) && isset($fin['fileCount'])) ? intval($fin['fileCount']) : $total_files;
        $log[] = "Klaar. Totaal opgeslagen in Nebula: {$count} bestanden.";

        $this->die_with_message('Export voltooid! Open project ' . $project_id . ' in Nebula.', $log, true);
    }

    // --- Bestanden verzamelen & verzenden ------------------------------------

    private function send_files($api, $token, $project_id, $include_uploads, &$log) {
        $root = untrailingslashit(ABSPATH);
        $uploads = wp_get_upload_dir();
        $uploads_base = isset($uploads['basedir']) ? untrailingslashit($uploads['basedir']) : '';

        // We sturen wp-content plus de PHP-bestanden in de root. WP-core (wp-admin/wp-includes) laten
        // we standaard weg: dat is boilerplate en enorm. wp-config.php gaat mee maar gesaniteerd.
        $targets = array();
        $wp_content = untrailingslashit(WP_CONTENT_DIR);
        if (is_dir($wp_content)) {
            $targets[] = $wp_content;
        }
        // Losse PHP/config-bestanden in de root.
        foreach (glob($root . '/*.php') as $f) {
            $targets[] = $f;
        }
        foreach (array('.htaccess', 'robots.txt') as $extra) {
            if (file_exists($root . '/' . $extra)) {
                $targets[] = $root . '/' . $extra;
            }
        }

        $batch = array();
        $batch_bytes = 0;
        $sent = 0;

        $flush = function () use (&$batch, &$batch_bytes, $api, $token, $project_id, &$sent, &$log) {
            if (empty($batch)) {
                return true;
            }
            $res = $this->api_post($api, '/api/import/wordpress/files', $token, array(
                'projectId' => $project_id,
                'files'     => $batch,
            ));
            if (is_wp_error($res)) {
                return $res;
            }
            $sent += isset($res['written']) ? intval($res['written']) : count($batch);
            $batch = array();
            $batch_bytes = 0;
            return true;
        };

        foreach ($targets as $target) {
            $files = is_dir($target) ? $this->iterate_dir($target) : array($target);
            foreach ($files as $abs) {
                if (!$include_uploads && $uploads_base && strpos($abs, $uploads_base) === 0) {
                    continue;
                }
                $rel = $this->rel_path($abs, $root);
                if ($rel === null) {
                    continue;
                }
                $size = @filesize($abs);
                if ($size === false || $size > self::MAX_FILE_BYTES) {
                    $log[] = "Overgeslagen (te groot): {$rel}";
                    continue;
                }

                // Groot bestand? Apart in chunks sturen (buiten de batch om).
                if ($size > self::CHUNK_BYTES) {
                    $flushed = $flush();
                    if (is_wp_error($flushed)) return $flushed;
                    $raw = @file_get_contents($abs);
                    if ($raw === false) { $log[] = "Onleesbaar: {$rel}"; continue; }
                    $r = $this->send_big_file($api, $token, $project_id, $rel, $raw, $this->is_binary($abs, $raw));
                    if (is_wp_error($r)) return $r;
                    $sent++;
                    continue;
                }

                $raw = @file_get_contents($abs);
                if ($raw === false) { $log[] = "Onleesbaar: {$rel}"; continue; }
                $binary = $this->is_binary($abs, $raw);
                if ($rel === 'wp-config.php') {
                    $raw = $this->sanitize_wp_config($raw);
                }
                $part = array(
                    'path'     => $rel,
                    'content'  => $binary ? base64_encode($raw) : $raw,
                    'encoding' => $binary ? 'base64' : 'utf8',
                );
                $batch[] = $part;
                $batch_bytes += strlen($part['content']);
                if ($batch_bytes >= self::BATCH_BYTES) {
                    $flushed = $flush();
                    if (is_wp_error($flushed)) return $flushed;
                }
            }
        }

        $flushed = $flush();
        if (is_wp_error($flushed)) return $flushed;
        return $sent;
    }

    // Stuur één (mogelijk groot) bestand in chunks: eerste part vervangt, rest append't.
    private function send_big_file($api, $token, $project_id, $rel, $raw, $binary) {
        $encoded = $binary ? base64_encode($raw) : $raw;
        $len = strlen($encoded);
        $offset = 0;
        $first = true;
        while ($offset < $len || $first) {
            $slice = substr($encoded, $offset, self::CHUNK_BYTES);
            $offset += strlen($slice);
            $res = $this->api_post($api, '/api/import/wordpress/files', $token, array(
                'projectId' => $project_id,
                'files'     => array(array(
                    'path'     => $rel,
                    'content'  => $slice,
                    'encoding' => $binary ? 'base64' : 'utf8',
                    'append'   => !$first,
                )),
            ));
            if (is_wp_error($res)) {
                return $res;
            }
            $first = false;
            if ($slice === '') {
                break;
            }
        }
        return true;
    }

    private function iterate_dir($dir) {
        $out = array();
        try {
            $it = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
                RecursiveIteratorIterator::LEAVES_ONLY
            );
            foreach ($it as $file) {
                if ($file->isFile()) {
                    $out[] = $file->getPathname();
                }
            }
        } catch (Exception $e) {
            // Onleesbare map — negeren.
        }
        return $out;
    }

    private function rel_path($abs, $root) {
        $abs = str_replace('\\', '/', $abs);
        $root = str_replace('\\', '/', $root);
        if (strpos($abs, $root) !== 0) {
            return null;
        }
        $rel = ltrim(substr($abs, strlen($root)), '/');
        return $rel !== '' ? $rel : null;
    }

    private function is_binary($path, $content) {
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $text_ext = array('php','html','htm','css','scss','js','mjs','cjs','json','svg','ts','tsx','jsx','md','txt','xml','yml','yaml','sql','ini','csv','po','pot');
        if (in_array($ext, $text_ext, true)) {
            return false;
        }
        // Heuristiek: NUL-byte in de eerste 8 KB → binair.
        return strpos(substr($content, 0, 8192), "\0") !== false;
    }

    // Verwijder DB-wachtwoorden en salts uit wp-config voordat we het versturen.
    private function sanitize_wp_config($content) {
        $keys = array('DB_PASSWORD', 'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY',
                      'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT');
        foreach ($keys as $k) {
            $content = preg_replace(
                "/(define\\(\\s*['\"]" . preg_quote($k, '/') . "['\"]\\s*,\\s*)(['\"]).*?(['\"])/s",
                "$1$2***VERWIJDERD***$3",
                $content
            );
        }
        return $content;
    }

    // --- Database-dump (puur PHP via $wpdb, geen mysqldump nodig) -------------

    private function dump_database() {
        global $wpdb;
        $out = "-- Nebula WordPress database dump\n-- Site: " . home_url() . "\n-- Datum: " . gmdate('Y-m-d H:i:s') . " UTC\n\n";
        $out .= "SET FOREIGN_KEY_CHECKS=0;\n\n";

        $tables = $wpdb->get_col('SHOW TABLES');
        foreach ($tables as $table) {
            $create = $wpdb->get_row("SHOW CREATE TABLE `$table`", ARRAY_N);
            if (!$create || !isset($create[1])) {
                continue;
            }
            $out .= "-- ----------------------------\n-- Tabel: $table\n-- ----------------------------\n";
            $out .= "DROP TABLE IF EXISTS `$table`;\n";
            $out .= $create[1] . ";\n\n";

            $rows = $wpdb->get_results("SELECT * FROM `$table`", ARRAY_A);
            if (empty($rows)) {
                continue;
            }
            $cols = array_keys($rows[0]);
            $col_list = '`' . implode('`, `', $cols) . '`';
            foreach (array_chunk($rows, 200) as $chunk) {
                $values = array();
                foreach ($chunk as $row) {
                    $vals = array();
                    foreach ($cols as $c) {
                        $v = $row[$c];
                        $vals[] = is_null($v) ? 'NULL' : "'" . esc_sql($v) . "'";
                    }
                    $values[] = '(' . implode(', ', $vals) . ')';
                }
                $out .= "INSERT INTO `$table` ($col_list) VALUES\n" . implode(",\n", $values) . ";\n";
            }
            $out .= "\n";
        }
        $out .= "SET FOREIGN_KEY_CHECKS=1;\n";
        return $out;
    }

    // --- HTTP-helper ---------------------------------------------------------

    private function api_post($api, $path, $token, $body) {
        $url  = $api . $path;
        $json = wp_json_encode($body);
        // We volgen redirects ZELF (redirection => 0). Cruciaal: bij een domein-redirect
        // (bijv. nebulabookings.com → www.nebulabookings.com) gooien HTTP-clients standaard de
        // POST-body en de Authorization-header weg. Door de POST expliciet opnieuw te sturen naar
        // de Location behouden we methode + body + token, zodat de export niet stilletjes faalt.
        $args = array(
            'timeout'     => 120,
            'redirection' => 0,
            'headers'     => array(
                'Content-Type'  => 'application/json',
                'Authorization' => 'Bearer ' . $token,
            ),
            'body' => $json,
        );

        $response = null;
        for ($hop = 0; $hop < 5; $hop++) {
            $response = wp_remote_post($url, $args);
            if (is_wp_error($response)) {
                return $response;
            }
            $code = wp_remote_retrieve_response_code($response);
            if (in_array($code, array(301, 302, 303, 307, 308), true)) {
                $loc = wp_remote_retrieve_header($response, 'location');
                if (empty($loc)) {
                    break;
                }
                // Relatieve Location → absoluut maken op basis van de huidige URL.
                if (strpos($loc, 'http://') !== 0 && strpos($loc, 'https://') !== 0) {
                    $p = wp_parse_url($url);
                    $base = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
                    $loc = $base . '/' . ltrim($loc, '/');
                }
                $url = $loc;
                continue; // stuur dezelfde POST (headers + body) opnieuw naar de nieuwe URL
            }
            break;
        }

        $code = wp_remote_retrieve_response_code($response);
        $data = json_decode(wp_remote_retrieve_body($response), true);
        if ($code < 200 || $code >= 300) {
            $msg = is_array($data) && isset($data['error']) ? $data['error'] : ('HTTP ' . $code . ' bij ' . $url);
            return new WP_Error('nebula_http', $msg);
        }
        return is_array($data) ? $data : array();
    }

    private function err_text($maybe_error) {
        if (is_wp_error($maybe_error)) {
            return $maybe_error->get_error_message();
        }
        return 'onbekende fout';
    }

    private function die_with_message($message, $log = array(), $success = false) {
        $color = $success ? '#0a7d28' : '#b32d2e';
        echo '<div class="wrap"><h1>Nebula Export</h1>';
        echo '<div style="padding:12px 16px;border-left:4px solid ' . esc_attr($color) . ';background:#fff;margin:12px 0;"><strong>' . esc_html($message) . '</strong></div>';
        if (!empty($log)) {
            echo '<h2>Logboek</h2><pre style="background:#f6f7f7;padding:12px;white-space:pre-wrap;">';
            echo esc_html(implode("\n", $log));
            echo '</pre>';
        }
        echo '<p><a class="button" href="' . esc_url(admin_url('tools.php?page=nebula-export')) . '">← Terug</a></p>';
        echo '</div>';
        exit;
    }
}

new Nebula_Exporter();
