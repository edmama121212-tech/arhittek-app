<?php
/**
 * Plugin Name: ARHITTEK — Рабочее приложение
 * Description: Открывает рабочее приложение на /app/ и каталог на /app/catalog/.
 * Version: 3.72.0
 */
defined('ABSPATH') || exit;

// Run after WordPress has resolved its normal pages. Existing catalog pages and
// other plugins keep their own /catalog-projects/ route. Only the app owns /app/.
add_filter('template_include', static function ($template) {
    $path = wp_parse_url(wp_unslash($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
    $home = rtrim((string) wp_parse_url(home_url('/'), PHP_URL_PATH), '/');
    $path = rtrim((string) $path, '/');
    $routes = array(
        $home . '/app' => 'index.html',
        $home . '/app/catalog' => 'catalog.html',
    );
    if (is_404()) {
        $routes[$home . '/catalog-projects'] = 'catalog.html';
    }
    if (!isset($routes[$path])) {
        return $template;
    }
    // The target is a real static file, including on hosts where nginx serves
    // JavaScript and styles directly without routing requests through PHP.
    $target = plugins_url('app/' . $routes[$path], __FILE__);
    $query = wp_parse_url(wp_unslash($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_QUERY);
    if (is_string($query) && $query !== '') {
        $target .= '?' . $query;
    }
    nocache_headers();
    wp_safe_redirect($target, 302);
    exit;
}, 99);
