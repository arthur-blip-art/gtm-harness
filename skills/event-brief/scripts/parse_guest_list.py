#!/usr/bin/env python3
"""Turn a pasted guest list (Luma, Partiful, Eventbrite, Meetup, a conference attendee page) into one CSV row per person.

  python3 parse_guest_list.py <pasted.txt | -> [--platform luma|partiful|eventbrite|meetup|conference|generic]
                              [--source "URL, or 'pasted by user YYYY-MM-DD'"] [--out guests.csv]

Input: whatever the user copied after a select-all on the guest list, or a transcription of screenshots.
One person per line, or a name line followed by a bio line (Luma style). Extra text on the same line can be
separated by ' | '.

What it does, and what it refuses to do:
- drops platform noise: counts ('42 going'), '+2', 'View all', 'Host' badges, emoji-only lines, stats lines;
- reads status headers ('Going', 'Maybe', 'Hosts', 'Inscrits', 'Waitlist') into list_status;
- fills person_title and company ONLY when the text says so explicitly ('<title> at|@|chez|bij <company>').
  Anything else stays in raw_bio. It never guesses a title from a name or a company from an email domain;
- a person without a company is still a row;
- removes e-mail addresses and phone numbers from the output and counts them: they are personal data the
  brief does not need. A LinkedIn URL written by the guest on the page is kept;
- marks every row check=UNVERIFIED: a guest list is self-declared, and a title read in a bio is not a fact
  until the company's own page or the person's public profile confirms it.

Standard library only. Prints a one-line summary; the CSV goes to --out (default: stdout).
"""
import argparse, csv, re, sys, unicodedata

STATUS = {
    'going': 'going', 'attending': 'going', 'attendees': 'going', 'guests': 'going', 'participants': 'going',
    'inscrits': 'going', 'registered': 'going', 'deelnemers': 'going', 'aanwezig': 'going',
    'maybe': 'maybe', 'peut-etre': 'maybe', 'interested': 'interested', 'interesses': 'interested',
    "can't go": 'declined', 'cant go': 'declined', 'not going': 'declined',
    'waitlist': 'waitlist', 'waitlisted': 'waitlist', "liste d'attente": 'waitlist',
    'hosts': 'host', 'hosted by': 'host', 'organisateurs': 'host', 'speakers': 'speaker', 'intervenants': 'speaker',
}
BADGES = {'host': 'host', 'co-host': 'host', 'cohost': 'host', 'organizer': 'host', 'organiser': 'host',
          'organisateur': 'host', 'organisatrice': 'host', 'event host': 'host', 'speaker': 'speaker',
          'intervenant': 'speaker', 'intervenante': 'speaker'}
NOISE = [r'^\+\d+$', r'^\d+\s*(guests?|going|attendees?|members?|on the list|participants?|inscrits?|others?)$',
         r'^(and|et) \d+ (others?|autres)$', r'^(view|see|show|load) (all|more)$', r'^(voir|afficher) (tout|plus)$',
         r'^(guest list|attendee list|liste des invit[eé]s|who.?s going)$', r'^\d+ events? attended$',
         r'^(rsvp|register|join|get on the list|s.inscrire)$', r'^(you|me|vous|moi)$', r'^\W*$']
TITLE_WORDS = (r'\b(ceo|cto|cfo|coo|cpo|cmo|vp|svp|head|founder|co-?founder|fondat\w*|cofondat\w*|directeur|directrice|'
               r'director|manager|lead|chief|president|pr[eé]sident\w*|partner|associ[eé]e?|consultant\w*|engineer|'
               r'ing[eé]nieur\w*|d[eé]veloppeu\w*|developer|responsable|product|sales|marketing|growth|account|owner|'
               r'g[eé]rant\w*|analyst|analyste|advisor|investor|student|[eé]tudiant\w*|freelance\w*)\b')
PARTICLES = {'de', 'du', 'des', 'la', 'le', 'van', 'der', 'den', 'von', 'da', 'di', "d'", 'el', 'ben', 'ter', 'op'}
EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')
PHONE = re.compile(r'(?<!\w)(?:\+|00)?\d[\d .()-]{7,}\d(?!\w)')
LINKEDIN = re.compile(r'https?://(?:[a-z]{2,3}\.)?linkedin\.com/in/[\w%-]+/?', re.I)
AT = re.compile(r'^(?P<title>.{2,80}?)\s+(?:at|@|chez|bij|bei)\s+(?P<company>[^,|;·•]{2,60}?)(?:\s*[·•,]\s*[^|;]{0,40})?$', re.I)

def fold(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower().strip()

def no_emoji(s):
    return re.sub(r'\s+', ' ', ''.join(c for c in s if unicodedata.category(c) not in ('So', 'Sk', 'Cs', 'Co', 'Cf'))).strip()

def is_noise(s):
    return any(re.match(p, fold(s)) for p in NOISE)

def looks_like_name(s):
    s = no_emoji(s)
    if not s or len(s) > 50 or re.search(r'https?://|@|\d|[!?;:]', s) or re.search(TITLE_WORDS, fold(s)):
        return False
    tokens = s.replace('-', ' ').split()
    if not 1 <= len(tokens) <= 5:
        return False
    for t in tokens:
        if fold(t) in PARTICLES:
            continue
        if not re.match(r"^[A-ZÀ-ÖØ-Þ][\w'’.]*$", t) or not re.match(r"^[^\W\d_][\w'’.]*$", t):
            return False
    return True

def split_bio(bio):
    """Title and company only when the bio states both with an explicit separator. Otherwise nothing."""
    m = AT.match(bio.strip(' -–·|'))
    if not m:
        return '', ''
    return m.group('title').strip(' ,-–·'), m.group('company').strip(' ,.-–·')

def parse(lines, source):
    rows, current, status = [], None, 'going'
    removed = {'emails': 0, 'phones': 0}

    def scrub(text):
        removed['emails'] += len(EMAIL.findall(text)); text = EMAIL.sub('', text)
        removed['phones'] += len(PHONE.findall(text)); text = PHONE.sub('', text)
        return re.sub(r'\s+', ' ', text).strip(' |,')

    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        key = fold(no_emoji(line)).strip(' :')
        head = re.sub(r'\s*\(?\d+\)?$', '', key)
        if head in STATUS:
            current, status = None, STATUS[head]
            continue
        if key in BADGES:
            if current: current['list_status'] = BADGES[key]
            continue
        if is_noise(line):
            continue
        linkedin = LINKEDIN.search(line)
        line = scrub(LINKEDIN.sub('', line))
        name, _, extra = (p.strip() for p in line.partition(' | '))
        badge = ''
        for b, st in BADGES.items():
            if re.search(rf'\s*[·-]?\s*\b{re.escape(b)}\b$', fold(name)) and fold(name) != b:
                badge, name = st, re.sub(rf'\s*[·-]?\s*\b{re.escape(b)}\b$', '', name, flags=re.I).strip()
        name = re.sub(r'\s\+\d+$', '', name)
        if looks_like_name(name):
            full = no_emoji(name)
            last = full.split(' ', 1)[1] if ' ' in full else ''
            current = {'person_name': full, 'partial_name': 'yes' if not last or re.fullmatch(r'\w\.?', last) else 'no',
                       'list_status': badge or status, 'raw_bio': extra, 'linkedin_url': linkedin.group(0) if linkedin else '',
                       'source': source, 'raw_line': raw.strip()}
            rows.append(current)
        elif current:                   # a bio line under the name (Luma), or a stray line: keep it, do not interpret it
            if line:
                current['raw_bio'] = (current['raw_bio'] + ' | ' + line).strip(' |')
            if linkedin and not current['linkedin_url']:
                current['linkedin_url'] = linkedin.group(0)

    out, seen, dupes = [], set(), 0
    for r in rows:
        r['person_title'], r['company'] = split_bio(r['raw_bio'].split(' | ')[0]) if r['raw_bio'] else ('', '')
        k = (fold(r['person_name']), fold(r['company']))
        if k in seen:
            dupes += 1
            continue
        seen.add(k)
        r['guest_id'] = f'g_{len(out) + 1:03d}'
        r['check'] = 'UNVERIFIED'
        out.append(r)
    return out, removed, dupes

COLS = ['guest_id', 'person_name', 'partial_name', 'list_status', 'person_title', 'company', 'linkedin_url',
        'raw_bio', 'source', 'check', 'raw_line']

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('input', help="pasted text file, or '-' for stdin")
    ap.add_argument('--platform', default='generic', choices=['luma', 'partiful', 'eventbrite', 'meetup', 'conference', 'generic'])
    ap.add_argument('--source', default='', help="the event URL, or 'pasted by user YYYY-MM-DD'")
    ap.add_argument('--out', default='-')
    a = ap.parse_args()
    text = sys.stdin.read() if a.input == '-' else open(a.input, encoding='utf-8').read()
    rows, removed, dupes = parse(text.splitlines(), a.source or f'pasted ({a.platform})')
    f = sys.stdout if a.out == '-' else open(a.out, 'w', newline='', encoding='utf-8')
    w = csv.DictWriter(f, fieldnames=COLS, extrasaction='ignore')
    w.writeheader(); w.writerows(rows)
    if f is not sys.stdout: f.close()
    with_co = sum(1 for r in rows if r['company'])
    partial = sum(1 for r in rows if r['partial_name'] == 'yes')
    print(f"{len(rows)} people ({with_co} with a stated company, {len(rows) - with_co} without, {partial} partial names), "
          f"{dupes} duplicates merged, {removed['emails']} e-mails and {removed['phones']} phone numbers removed. "
          f"All rows UNVERIFIED.", file=sys.stderr)
    if not rows:
        print('No names recognised: ask for the list again, one person per line, or as screenshots.', file=sys.stderr)

if __name__ == '__main__':
    main()
