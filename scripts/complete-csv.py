import csv
import re
import requests
from io import StringIO
from urllib.parse import urljoin
from bs4 import BeautifulSoup

# python3 -m venv .venv
# source .venv/bin/activate
# pip install requests
# python complete-csv.py
# deactivate

CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTQcRY-S8AOXcFLucMvZ95qyaqMK5rGjYzKgUye5FryhxWhymuzgFgZ-HrdC2sFOcljjgHZSjgPwySE/pub?output=csv'

response = requests.get(CSV_URL)
response.raise_for_status()

# reader = csv.DictReader(response.text.splitlines())
reader = csv.DictReader(StringIO(response.text))

words = []

def getWordData(row):
    sindarin = row["sindarin"].strip()
    w_url = row["url"].strip()

    eldamo_response = requests.get(w_url)
    eldamo_response.raise_for_status()
    eldamo_soup = BeautifulSoup(eldamo_response.text, 'html.parser')
    lang = eldamo_soup.find('p', id_='lang-word').text.strip()
    print(sindarin, lang)

    # type if S. attested else if N. restored else if ᴺS. [N.] or ᴺS. [G.] or ᴺS. [N.] [G.] reconstructed else empty
    # source if S. tolkien else if N. or ᴺS. [N.] or ᴺS. [N.] [G.] noldorin else if ᴺS. [G.] gnomish else empty
    # status empty
    # noldorin_form empty
    # eldamo_id take from url
    # url empty
    # notes empty
    # references under <u>references</u>, skip the star symbol
    # inflection_base empty
    # inflection_singular empty

    # root_refs
    # primitive_eldamo_id
    # primitive_form
    # development
    # elements
    # quettamorphosis_url
    # cognates
    # conjugation_class
    # conjugation_irregular
    # hidden
    # swadesh

for row in reader:
    if row["uuid"].strip():
        continue
    
    word = row["sindarin"].strip()
    if word:
        getWordData(row)
        # words.append(word)

print(words)



# for i, row in enumerate(reader, start=2):  # start=2 because row 1 is header
#     id_value = row.get("uuid", "").strip()
#     word = row.get("sindarin", "").strip()

#     print(f"Row {i}: uuid={id_value!r}, word={word!r}")

#     if id_value:
#         continue

#     if word:
#         words.append(word)

# print("\nFinal words:")
# print(words)