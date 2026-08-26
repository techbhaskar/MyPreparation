#!/usr/bin/env python3
import sys
from pathlib import Path
import textwrap
from datetime import date

ROOT = Path(__file__).resolve().parents[1]
TODAY = date.today().isoformat()
MAX_WIDTH = 100

def is_table_line(line):
    return '|' in line and not line.strip().startswith('```')

def is_list_line(line):
    s = line.lstrip()
    return s.startswith('- ') or s.startswith('* ') or s[:3].isdigit() and s[3:4]=='.'

def process_file(path: Path):
    text = path.read_text(encoding='utf-8')
    lines = text.splitlines()

    out_lines = []
    i = 0
    n = len(lines)
    in_code = False
    # track blocks to skip wrapping: code fences, tables, lists
    while i < n:
        line = lines[i]
        if line.strip().startswith('```'):
            in_code = not in_code
            out_lines.append(line)
            i += 1
            continue
        if in_code:
            out_lines.append(line)
            i += 1
            continue

        # H1 handling: insert subtitle and last-updated after first H1
        if line.startswith('# '):
            out_lines.append(line)
            # look ahead for subtitle/last-updated
            j = i+1
            # skip blank lines
            while j < n and lines[j].strip() == '':
                j += 1
            inserted = False
            if j < n and lines[j].strip().lower().startswith('last updated'):
                # replace date
                out_lines.append(f'Last updated: {TODAY}')
                i = j+1
                inserted = True
            else:
                # insert a short italic subtitle if next line is not italic
                if j >= n or not lines[j].lstrip().startswith('_'):
                    out_lines.append('_Overview and notes._')
                out_lines.append(f'Last updated: {TODAY}')
                i = i+1
                inserted = True
            if inserted:
                # continue from current i (we already appended replacements)
                # skip any existing last-updated lines to avoid duplication
                while i < n and lines[i].strip().lower().startswith('last updated'):
                    i += 1
                continue

        # Tables: detect simple table blocks and copy as-is
        if is_table_line(line):
            out_lines.append(line)
            i += 1
            continue

        # Lists: copy contiguous list block without reflow
        if line.lstrip().startswith(('-', '*')) or (line.lstrip()[:1].isdigit() and line.lstrip().split('.',1)[0].isdigit()):
            out_lines.append(line)
            i += 1
            continue

        # Headings and short lines: copy
        if line.startswith('#') or len(line) <= MAX_WIDTH:
            out_lines.append(line)
            i += 1
            continue

        # Reflow paragraph: collect until blank line or special block
        para = []
        while i < n and lines[i].strip() != '' and not lines[i].strip().startswith('```') and not is_table_line(lines[i]) and not lines[i].lstrip().startswith(('-', '*')) and not lines[i].startswith('#'):
            para.append(lines[i].strip())
            i += 1
        if para:
            joined = ' '.join(para)
            wrapped = textwrap.fill(joined, width=MAX_WIDTH)
            # wrap paragraph with a justified div so rendered HTML/MD supports justification
            out_lines.append('<div style="text-align:justify">')
            out_lines.extend(wrapped.splitlines())
            out_lines.append('</div>')
        # preserve blank lines
        if i < n and lines[i].strip() == '':
            out_lines.append('')
            i += 1

    new_text = '\n'.join(out_lines) + '\n'
    if new_text != text:
        path.write_text(new_text, encoding='utf-8')
        print(f'Updated: {path.relative_to(ROOT)}')
    else:
        print(f'Unchanged: {path.relative_to(ROOT)}')

def main():
    md_files = list(ROOT.glob('*.md')) + list((ROOT).glob('*.md'))
    # also include nested md files in root
    md_files = sorted({p for p in ROOT.rglob('*.md') if 'node_modules' not in str(p)})
    for p in md_files:
        process_file(p)

if __name__ == '__main__':
    main()
