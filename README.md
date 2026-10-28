# Grossrelief – Kartenprojektor v5.10

Neu gestaltete, helle und kompakte Hauptoberfläche auf Basis von v5.9.18.

- **Dateien** öffnet ein einziges aufklappbares Menü für Import und Export (CSV, Kartenbilder, STL, Höhenraster, Kalibrierung, PNG und ZIP).
- **Ebenen 1–9** stehen mit kleinen Checkboxen **direkt unter der Vorschau**; Mehrfachauswahl bleibt möglich.
- **Hauptansicht hell** und reduziert: Kartenmodus, Wädenswil-Maske, 3D-Korrektur und Projektorhöhe bleiben sichtbar und einstellbar.
- **ⓘ-Schaltflächen** öffnen Hilfefenster anstatt langer Anleitungen neben Bedienelementen.
- **Dunkler Vollbild-Projektionsmodus bleibt unverändert**, einschliesslich der Kurztasten 1–9, der K-Eckkalibrierung, der roten Bildschirmmitte, der gelben Zielkreuze und der 3D-Projektion.
- Aus v5.9.18 übernommen: `stl/relief-heightmap.json` und `examples/layout.csv`.

## Installation

Alle Dateien und Unterordner des ZIP in das bestehende GitHub-Pages-Repository hochladen. `index.html` ersetzen. Browser mit Strg+F5 aktualisieren.

Der neue HTML-Einstiegspunkt lädt explizit `core.v5.10.js`, `hydro.v5.10.js`, `terrain.v5.10.js`, `app.v5.10.js` und `style.v5.10.css`. Ältere Versionen im Repository können bestehen bleiben.

Keine Änderungen an den swisstopo-Datenquellen, der Gewässerauswahl, der Geometrieberechnung, dem Höhenmodell oder der Projektorrenderung.
