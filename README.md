# Hive Mind: survey showdown

A party game for a room full of friends. A survey asked 100 people a question; teams try to name the most popular answers. The laptop or TV is the big board, and your phone is the remote.

Everything runs on your own Wi-Fi. Nothing is online, nothing is deployed, no accounts.

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

The terminal prints three addresses:

| What | Where |
|---|---|
| Big screen (open on the laptop, put it on the TV) | `http://localhost:4000/` |
| Phone remote | `http://<your-laptop-ip>:4000/remote` |
| Question editor | `http://localhost:4000/editor` |

The big screen also shows a QR code for the remote. Scan it with your phone camera.

### First run on Windows

The first time you run `npm start`, Windows Defender Firewall asks whether Node.js may use the network. Tick **Private networks** and click **Allow access**. If you clicked Cancel by accident, phones will not be able to connect: open *Windows Security > Firewall & network protection > Allow an app through firewall*, find **Node.js JavaScript Runtime** and tick **Private**.

Also make sure your home Wi-Fi is set to a **Private** network in Windows (Settings > Network & internet > Wi-Fi > your network). Public networks block incoming connections.

### Phone cannot connect?

1. The phone must be on the same Wi-Fi as the laptop (not mobile data, not a guest network).
2. If the laptop has several network adapters (VPN, VirtualBox, VMware), the QR code may point at the wrong one. Click the address under the QR code on the big screen to cycle through the others, or start with your Wi-Fi address forced:
   ```bash
   HOST_IP=192.168.0.50 npm start
   ```
   (PowerShell: `$env:HOST_IP="192.168.0.50"; npm start`. Find the address with `ipconfig`, under "Wireless LAN adapter Wi-Fi".)
3. Port 4000 taken? Start on another one: `PORT=4100 npm start` (PowerShell: `$env:PORT=4100; npm start`).

## Running a party

1. Plug the laptop into the TV, open `http://localhost:4000/` and press **F** for full screen. Click once anywhere to turn on sound.
2. Open the remote on your phone. In **Setup**, pick 2 or 3 teams, type the team names and tap **New game**.
3. Optional: in **Setup > Lock the remote**, set a PIN so only your phone can control the game. Friends who scan the QR code without it get a read-only scoreboard.
4. Hide the QR code (Setup, or press **Q** on the laptop) once everyone is in.

### Playing a round

The remote shows you every answer and its points. The big screen keeps them hidden.

1. Read the question. Two players race to answer; whichever team wins the face-off is **playing**. Tap their name under *Who is playing this round?*
2. Each time someone names an answer on the board, tap it on the remote. It flips on the big screen and its points go into the **pot**.
3. A wrong answer? Tap **Strike**. Three strikes and the board flashes **Steal chance** for the other team(s).
4. Give the pot to whoever won the round: the playing team if they cleared the board, or the stealing team if their steal answer was on the board (reveal it first so its points join the pot).
5. Tap **Reveal all** to show what nobody guessed (those answers show in a paler colour and earn no points), then **Next question**.

Rounds can be worth **Single**, **Double** or **Triple** points. Pick it before you award the pot (a nice way to raise the stakes for the last few questions).

### Fixing mistakes

* **Undo** (top right of the remote) steps back one action at a time: reveals, strikes, awards, score changes, even a new game.
* Tap an answer that is already showing to hide it again.
* **Scores** tab: nudge any team up or down by 1, 5 or 10.
* **Restart this round** hides everything, clears strikes and takes back any points given for that question.

### Ending the game

**Scores > Show final scores** puts the standings on the TV with a winner banner. Tap it again to go back to the board.

## Laptop keyboard shortcuts

Press **H** on the big screen to see these.

| Key | Action |
|---|---|
| 1 to 8 | Reveal that answer |
| X | Strike |
| A | Reveal all |
| Shift + 1, 2, 3 | Give the pot to team 1, 2 or 3 |
| Left / Right arrows | Previous / next question |
| U or Ctrl + Z | Undo |
| Q | Show or hide the join QR code |
| S | Final scores on or off |
| F | Full screen |
| M | Sound on or off |

The laptop running the server is always trusted, even when a PIN is set. To make it enter the PIN too, start with `LOCAL_TRUST=off`.

## Questions

The questions live in `questions.json`. There are 24 to start with. Edit them in the browser at `http://localhost:4000/editor` (changes go live straight away), or edit the file by hand while the server is stopped:

```json
{
  "question": "Name something you spread on toast.",
  "answers": [
    { "text": "Butter", "points": 45 },
    { "text": "Jam", "points": 25 },
    { "text": "Peanut butter", "points": 18 },
    { "text": "Avocado", "points": 12 }
  ]
}
```

* 1 to 8 answers per question. Points are "how many out of 100 said this" and the board sorts them highest first.
* The `id` field is optional. The server adds one if it is missing and uses it to remember each round's progress.
* **Setup > Shuffle question order** gives a different running order for each new game.

## Saved game

Scores, revealed answers and the undo history are saved to `data/state.json` after every action, so a crash or restart picks up exactly where you left off. To wipe everything, stop the server and delete the `data` folder (or just tap **New game**).

## How it works

* `server.js`: Express plus Socket.IO. The server holds the only copy of the game state. The remote sends actions, the server applies them and pushes the new state to every screen. Screens that reconnect get the current state straight away.
* `public/index.html`: the big screen. Animations are CSS; sound effects are synthesized with the Web Audio API (no audio files).
* `public/remote.html`: the phone remote.
* `public/editor.html`: the question editor.
* The QR code is generated on the laptop by the `qrcode` package. No internet needed.

The big screen never receives the text of hidden answers, so nobody can peek with dev tools.
