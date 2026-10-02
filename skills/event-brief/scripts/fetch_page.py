#!/usr/bin/env python3
"""Fetch event pages the way a list needs to be read: raw HTML, visible text, tables, embedded JSON, candidate links.

One page, to explore:
  python3 fetch_page.py <url> [--out DIR] [--text-chars N] [--tables] [--images] [--max-links N] [--no-sitemap]

Many pages (one per speaker, one per session), to read them all without writing your own fetcher:
  python3 fetch_page.py --urls-file urls.txt [--out DIR] [--tables]
  → one line per URL (status, title, size) and one text file per page under DIR.

What it prints for a single page: final URL and status (with the reason when it fails), title, the years
mentioned, tables as tab-separated rows (--tables), images with file name, alt text and upload month (--images;
logo walls are often the only exhibitor list), links that look like speaker / session / exhibitor / sponsor pages
grouped by URL pattern, matching pages from the sitemap and its child sitemaps, the WordPress content types readable
as JSON when the site is WordPress, then the visible text without navigation.

Files are saved under --out (default: a folder in the system temp directory, never the project), named after
each URL, so two pages of the same site do not overwrite each other. Standard library only.
"""
import sys, re, os, json, html, hashlib, tempfile, urllib.request, urllib.parse

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
WORDS = (r'speaker|ponente|intervenant|referent|sprecher|relatore|agenda|program|programa|programme|schedule|session|sesion|'
         r'conference|conf[eé]rence|conferencia|atelier|workshop|taller|keynote|exhibitor|expositor|exposant|aussteller|'
         r'espositor|sponsor|partner|partenaire|patrocin|stand|whats-on|colaborador|collaborat|floorplan|plano|lista|'
         r'list|directory|annuaire|catalog')

def get(url, timeout=25):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/xml'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.geturl(), r.read().decode(r.headers.get_content_charset() or 'utf-8', 'replace'), ''
    except Exception as e:
        return getattr(e, 'code', 0), url, '', f'{type(e).__name__}: {getattr(e, "reason", e)}'

def clean(doc):
    """Drop what is never content: comments (sites leave last year's notes in them), scripts, styles."""
    doc = re.sub(r'(?s)<!--.*?-->', ' ', doc)
    return re.sub(r'(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>', ' ', doc)

def text_of(fragment):
    fragment = re.sub(r'(?i)<(br|/p|/div|/li|/h[1-6]|/tr)[^>]*>', '\n', fragment)
    fragment = html.unescape(re.sub(r'<[^>]+>', ' ', fragment))
    return re.sub(r'\n\s*\n+', '\n', re.sub(r'[ \t\r\f]+', ' ', fragment)).strip()

def visible(doc):
    body = re.sub(r'(?is)<(nav|header|footer)[^>]*>.*?</\1>', ' ', clean(doc))   # menus repeat on every page
    return text_of(body)

def tables(doc):
    out = []
    for t in re.findall(r'(?is)<table[^>]*>(.*?)</table>', clean(doc)):
        rows = []
        for tr in re.findall(r'(?is)<tr[^>]*>(.*?)</tr>', t):
            cells = [re.sub(r'\s+', ' ', text_of(c)) for c in re.findall(r'(?is)<t[dh][^>]*>(.*?)</t[dh]>', tr)]
            hrefs = re.findall(r'(?i)href=["\']([^"\'#]+)["\']', tr)
            if any(cells): rows.append('\t'.join(cells + hrefs[:1]))
        if rows: out.append(rows)
    return out

def slug(url):
    u = urllib.parse.urlparse(url)
    base = re.sub(r'[^a-z0-9]+', '-', (u.path.strip('/') or 'index').lower()).strip('-')[:60]
    return f'{base}-{hashlib.sha1(url.encode()).hexdigest()[:8]}' if u.query or len(base) >= 60 else base

def out_dir(args, host):
    d = args[args.index('--out') + 1] if '--out' in args else os.path.join(tempfile.gettempdir(), 'event-cache', host)
    os.makedirs(d, exist_ok=True); return d

def batch(args):
    urls = [l.strip() for l in open(args[args.index('--urls-file') + 1]) if l.strip() and not l.startswith('#')]
    want_tables = '--tables' in args; done = 0
    for u in urls:
        status, final, doc, err = get(u)
        d = out_dir(args, urllib.parse.urlparse(final).netloc)
        if not doc:
            print(f'{status}\t{u}\t-\t0\t{err}'); continue
        title = re.search(r'(?is)<title[^>]*>(.*?)</title>', doc)
        body = visible(doc)
        if want_tables:
            body += '\n\n' + '\n\n'.join('\n'.join(t) for t in tables(doc))
        path = os.path.join(d, slug(final) + '.txt'); open(path, 'w').write(f'URL: {final}\n\n{body}'); done += 1
        print(f'{status}\t{u}\t{html.unescape(title.group(1).strip())[:70] if title else "-"}\t{len(body)}\t{path}')
    print(f'\n{done} of {len(urls)} pages saved', file=sys.stderr)

def main():
    args = sys.argv[1:]
    if '--urls-file' in args: return batch(args)
    if not args or args[0].startswith('-'):
        print(__doc__); sys.exit(2)
    url = args[0]
    nchars = int(args[args.index('--text-chars') + 1]) if '--text-chars' in args else 6000
    max_links = int(args[args.index('--max-links') + 1]) if '--max-links' in args else 200
    status, final, doc, err = get(url)
    host = urllib.parse.urlparse(final).netloc
    out = out_dir(args, host); name = slug(final)
    print(f'url: {final}\nstatus: {status}{"  (" + err + ")" if err else ""}\nhtml: {len(doc)} chars')
    if not doc:
        print('nothing readable: blocked, missing, or not HTML. Try the sitemap or another page.'); sys.exit(1)
    open(os.path.join(out, name + '.html'), 'w').write(doc)
    title = re.search(r'(?is)<title[^>]*>(.*?)</title>', doc)
    print('title:', html.unescape(title.group(1).strip()) if title else '-')
    text = visible(doc)
    open(os.path.join(out, name + '.txt'), 'w').write(f'URL: {final}\n\n{text}')
    years = sorted(set(re.findall(r'\b(20[2-3]\d)\b', text[:20000])))
    print('years mentioned in the visible text:', ', '.join(years) or '-', "(check the edition: sites often keep last year's list)")
    # embedded JSON: where lists hide. Small blobs are site settings, not data.
    blobs = re.findall(r'(?is)<script[^>]*type=["\']application/(?:ld\+)?json["\'][^>]*>(.*?)</script>', doc)
    nd = re.search(r'(?is)<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', doc)
    if nd: blobs.append(nd.group(1))
    blobs += re.findall(r'(?s)=\s*(\[\s*\{.{2000,}?\}\s*\])\s*;', doc)
    saved = 0
    for i, b in enumerate(blobs):
        if len(b) < 1000: continue
        try: data = json.loads(b)
        except Exception: continue
        path = os.path.join(out, f'{name}-embedded-{i}.json'); json.dump(data, open(path, 'w'), ensure_ascii=False, indent=1); saved += 1
        print(f'embedded json: {path} ({len(b)} chars)')
    if not saved: print('embedded json: none worth reading')
    if len(text) < 1500 and len(doc) > 20000:
        print('warning: little visible text for a large page, the content is probably rendered in JavaScript. Read the embedded JSON, the sitemap, or one page per speaker.')
    tabs = tables(doc)
    if tabs:
        print(f'\ntables: {len(tabs)} ({", ".join(str(len(t)) + " rows" for t in tabs[:8])})' + ('' if '--tables' in args else '  → add --tables to print them as tab-separated rows'))
        if '--tables' in args:
            for i, t in enumerate(tabs):
                print(f'\n--- table {i + 1} ({len(t)} rows; last column is the row\'s first link) ---'); print('\n'.join(t))
    imgs = []
    for tag in re.findall(r'(?is)<img[^>]+>', clean(doc)):
        src = re.search(r'(?i)(?:data-src|src)=["\']([^"\']+)["\']', tag); alt = re.search(r'(?i)alt=["\']([^"\']*)["\']', tag)
        if not src: continue
        fn = os.path.splitext(os.path.basename(urllib.parse.urlparse(src.group(1)).path))[0]
        fn = re.sub(r'-\d+x\d+$', '', fn)
        yr = re.search(r'/(20[2-3]\d)/(\d{2})/', src.group(1))
        imgs.append((fn, alt.group(1).strip() if alt else '', f'{yr.group(1)}-{yr.group(2)}' if yr else ''))
    imgs = list(dict.fromkeys(imgs))
    if imgs:
        ypath = os.path.join(out, name + '-images.tsv'); open(ypath, 'w').write('\n'.join('\t'.join(i) for i in imgs))
        months = {}
        for i in imgs: months[i[2] or 'no date'] = months.get(i[2] or 'no date', 0) + 1
        print(f'\nimages: {len(imgs)} (file name, alt text, upload month) in {ypath}')
        print('  upload months:', ', '.join(f'{k} ×{v}' for k, v in sorted(months.items())), '(logos uploaded a year ago are probably last year\'s edition)')
        if '--images' in args:
            for i in imgs[:300]: print('  ' + '\t'.join(i))
        else: print('  add --images to print them; logo walls often have no text, so the file name is the only name')
    # candidate links, grouped by pattern so 111 session links read as one line plus examples
    root = '.'.join(host.split('.')[-2:])
    links = {}
    for href, label in re.findall(r'(?is)<a[^>]+href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', clean(doc)):
        full = urllib.parse.urljoin(final, href); lab = re.sub(r'\s+', ' ', text_of(label))[:60]
        if urllib.parse.urlparse(full).netloc.endswith(root) and re.search(WORDS, full + ' ' + lab, re.I):
            if full not in links or (lab and not links[full]): links[full] = lab
    groups = {}
    for l in links:
        u = urllib.parse.urlparse(l)
        pat = re.sub(r'/[^/]*\d[^/]*(?=/|$)', '/{id}', u.path) + ('?' + re.sub(r'=[^&]*', '=…', u.query) if u.query else '')
        pat = re.sub(r'/[^/]+/?$', '/{slug}', pat) if pat.count('/') >= 2 and '{id}' not in pat and not u.query else pat
        groups.setdefault(pat, []).append(l)
    print(f'\ncandidate links: {len(links)} in {len(groups)} patterns')
    shown = 0
    for pat, ls in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        print(f'  {pat}  ×{len(ls)}')
        for l in ls[:3]: print(f'      {l}  [{links[l]}]')
        shown += len(ls)
    all_links = os.path.join(out, name + '-links.txt'); open(all_links, 'w').write('\n'.join(list(links)[:max(max_links, len(links))]))
    print(f'  all {len(links)} links, one per line, ready for --urls-file: {all_links}')
    if '--no-sitemap' not in args:
        base = f'{urllib.parse.urlparse(final).scheme}://{host}'
        for sm in ('/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'):
            s, _, x, _e = get(base + sm, 15)
            if x:
                locs = re.findall(r'<loc>\s*([^<]+?)\s*</loc>', x)
                children = [l for l in locs if l.endswith('.xml')]
                pages = [l for l in locs if not l.endswith('.xml')]
                for c in children[:25]:                       # an index lists sitemaps, the pages are one level down
                    _s, _u, cx, _e2 = get(c, 15)
                    pages += re.findall(r'<loc>\s*([^<]+?)\s*</loc>', cx)
                hits = [l for l in pages if re.search(WORDS, l, re.I)]
                smpath = os.path.join(out, name + '-sitemap.txt'); open(smpath, 'w').write('\n'.join(pages))
                print(f'\nsitemap {base + sm}: {len(children)} child sitemaps, {len(pages)} pages, {len(hits)} matching (all pages in {smpath})')
                groups2 = {}
                for l in hits: groups2.setdefault('/'.join(urllib.parse.urlparse(l).path.strip('/').split('/')[:1]) or '/', []).append(l)
                for g, ls in sorted(groups2.items(), key=lambda kv: -len(kv[1]))[:25]: print(f'  /{g}/  ×{len(ls)}   e.g. {ls[0]}')
                break
        else:
            print('\nsitemap: none found at the usual paths')
    if 'wp-content' in doc or 'wp-json' in doc:
        st, _u, tj, _e3 = get(f'{urllib.parse.urlparse(final).scheme}://{host}/wp-json/wp/v2/types', 15)
        try:
            types = json.loads(tj); custom = [f"{k} (/wp-json/wp/v2/{v.get('rest_base', k)}?per_page=100)" for k, v in types.items() if k not in ('post', 'page', 'attachment', 'nav_menu_item', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles', 'wp_font_family', 'wp_font_face')]
            if custom: print('\nWordPress content types readable as JSON, often the whole speaker or session list in a few calls:\n  ' + '\n  '.join(custom))
        except Exception: pass
    print(f'\nvisible text ({len(text)} chars, first {nchars}; full text in {os.path.join(out, name + ".txt")}):\n')
    print(text[:nchars])

if __name__ == '__main__':
    main()
