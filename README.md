# Elternportal MCP

Inoffizieller MCP-Server für das WHG-Elternportal (`whgga.eltern-portal.org`), mit DSBmobile-Vertretungsplänen und optionalen E-Mail-/ntfy-Benachrichtigungen auf Ubuntu.

## Funktionen

- Kinder, Termine und Elternbriefe abrufen.
- Brieftexte lesen und Anhänge herunterladen, ohne den Empfang zu bestätigen.
- Stundenplan und Schulaufgabenplan lesen.
- DSBmobile-Pläne auf die Klasse filtern. Schulweite Hinweise bleiben als solche gekennzeichnet; persönliche Oberstufenkurse müssen selbst zugeordnet werden.
- Änderungen zweimal täglich prüfen und über E-Mail und ntfy melden. Vertretungen stehen direkt in der Push-Nachricht; E-Mails enthalten formatierte Kategorien und Stichpunkte.

## Installation

Voraussetzungen: Node.js 22 und pnpm.

```sh
pnpm install --frozen-lockfile --ignore-scripts
node --test mcp.test.mjs plans.test.mjs notify.test.mjs
```

Die Tests verwenden künstliche Daten und benötigen keine Portalzugänge. Live-Tests werden nur ausdrücklich über `Start-Test.ps1` oder `check-mcp.mjs` gestartet.

## MCP starten

`node mcp-server.mjs` startet den stdio-Server. Der aufrufende Prozess muss `ELTERNPORTAL_USER` und `ELTERNPORTAL_PASSWORD` als Umgebungsvariablen bereitstellen. Werte niemals in Quellcode, Git, Chat oder Tool-Argumenten hinterlegen.

Alternativ startet `node secret-launcher.mjs` mit einem lokalen Secret:

- Windows: `Zugang-einrichten.ps1` fragt die Zugangsdaten verdeckt ab und speichert sie mit DPAPI unter `%LOCALAPPDATA%\WHGElternportal\credentials.xml`. Nur das gleiche Windows-Benutzerkonto kann sie entschlüsseln. DSB benötigt separat `dsb.xml` im gleichen Format (`User` und `Password` als SecureStrings).
- Linux: systemd stellt `portal.json` und `dsb.json` im `CREDENTIALS_DIRECTORY` bereit. Beide enthalten die Felder `user` und `password`. Vorlagen dürfen keine echten Werte enthalten.

Werkzeuge: `list_children`, `get_timetable`, `list_events`, `list_parent_letters`, `get_parent_letter`, `download_letter_attachment`, `list_exams`, `get_substitutions`.

## Ubuntu-Automatisierung

Die mitgelieferten systemd-Dateien erwarten das Programm unter `/opt/whg-elternportal`, einen Systembenutzer `whg-portal` und verschlüsselte Credentials unter `/etc/credstore.encrypted/`. Zustand und Anhänge liegen unter `/var/lib/whg-elternportal` mit eingeschränkten Dateirechten.

`whg-elternportal.timer` prüft Montag bis Freitag um 06:30 Uhr und täglich um 18:00 Uhr (Europe/Berlin). Erst nach lokaler Einrichtung der Zugänge und erfolgreichen Live-Tests aktivieren.

Das zusätzliche verschlüsselte `notify.json` enthält `smtp` (host, port, secure, auth mit user/pass), `from`, `recipients` (Adressliste) und `ntfy` (HTTPS-Topic-URL). Diese Werte werden ausschließlich außerhalb des Repositorys eingerichtet. ntfy-Nachrichten enthalten Vertretungsinformationen: den Kanal daher passend schützen.

Der erste Lauf legt nur einen Vergleichsstand an. Spätere Änderungen werden in einer dauerhaften Warteschlange gespeichert. Erfolgreiche Zustellungen werden je Empfänger/Kanal vermerkt; fehlgeschlagene Zustellungen werden beim nächsten Lauf erneut versucht. Bei einem Absturz direkt nach Versand sind Doppelzustellungen möglich.

## Grenzen

- Auf das WHG zugeschnitten; andere Schulen benötigen Anpassungen und Tests.
- Die Automatisierung erwartet genau ein Kind. MCP unterstützt explizite Kindauswahl.
- Änderungen ausschließlich innerhalb vorhandener Anhänge werden nicht erkannt.
- Keine automatische KI-Zusammenfassung von PDFs.
- Portalzeiten können widersprüchlich sein und müssen im Zweifel geprüft werden.
- Abruffehler werden protokolliert, lösen aber derzeit keine eigene Push-Warnung aus.
- Anhänge werden bis insgesamt 15 MiB pro E-Mail versendet; größere Dateien bleiben im Archiv.

## Datenschutz und Quellen

Keine Zugangsdaten, Berichte, persönlichen Empfängeradressen oder Anhänge gehören in dieses Repository. MCP-Antworten enthalten angeforderte persönliche Schuldaten; nur vertrauenswürdige Clients verbinden.

Verwendete Bibliothek: [philippdormann/elternportal-api](https://github.com/philippdormann/elternportal-api). DSB-Schnittstellenreferenz: [udondan/dsbmobile](https://github.com/udondan/dsbmobile). Dieses Projekt ist kein offizielles Angebot der Schule oder der Portalbetreiber.
