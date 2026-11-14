# Sephral’s Tavern Games: Manual

## The tavern

Open the tavern from the token controls on the left (mug icon), with the mug below the chat log or with the button of a tavern chat message. Foundry ignores the token controls while no scene is shown, so in theater of the mind the mug in the chat is the way in. It shows while the chat tab is open in the sidebar. The tables are on the left, the chosen table on the right. Everyone sees every table and can watch. The gear in the title bar opens the tavern settings.

* **New table:** pick the game and an opponent. The dialog shows the guide of the chosen game. Against a regular the game starts right away (games for more players with two seats). *Wait for other players* opens the table and posts an invitation in the chat. Whoever clicks *Join* sits down.
* **More seats:** Pig, liar's dice and ship, captain and crew take two to four players, twenty-one one to four. The host can invite regulars to free seats (not at twenty-one) and starts the game with *Start*.
* **Your turn:** the line under the title says whose turn it is. When the tavern is closed and your turn comes, a notification tells you.
* **Buttons:** the players at a table see the buttons of the game (roll, hold, take, card, bid and so on), greyed out while it is somebody else's turn. Spectators and whoever left the table see the board without buttons.
* **Play again:** after a game, *Play again* starts a new round with the same seats. In games for two, the other one begins.
* **Guide:** every game has a short guide in the tongue of old. It shows while a table waits, the scroll next to the game's name shows it during the game.
* **Leave:** leaving a waiting table frees the seat (the host takes the table away). Leaving a running game loses it. In the games for more players (Pig, liar's dice, ship, captain and crew, twenty-one) the others play on without whoever left, as long as another player sits at the table or anybody still plays against the house (twenty-one). A regular never plays on alone. *Play again* leaves out whoever left.
* **Take the table away:** the host or the GM removes a table.

## The suggestion for the break

The tavern can suggest a game when the table takes a break, so that games get played that nobody thought of.

* **When:** the GM pauses the game, or clicks *Suggest a game* above the tables in the tavern (the button shows what is suggested while an offer runs, with *Take it back*). A pause brings a suggestion at most every ten minutes, only while a player is online, and only if the setting *Suggestion for the break* is on. The button always works.
* **What:** one game from the games on offer. A game nobody started yet in this world comes first, then the least played, never the same game twice in a row unless it is the only one. With one player online only games a regular can play are suggested, with company any game for two or more.
* **Who sees it:** the players, in a small window with the game, *Join in* and *Not now*. The GM sees no window. A player who sits at a table gets none. It stays for ten minutes (counted on each screen) or until the GM takes it back, switches the game off or the player says *Not now*. A player who joins later sees an offer that still runs.
* **One click:** the first click opens a table and sits the player down. Alone at the tavern the regular Old Bertram sits down too and the game starts at once. With company the table waits, the window of the others says who already sits there, and their click sits them down: a game for two then starts, a game for more players waits for the host to press *Start*. No invitation appears in the chat, the suggestion is the invitation.
* **The first game of a newcomer:** whoever has not finished a game in this world yet sees two lines above the board (how a turn works, and how the game is won). They end with the first finished game of that player and do not come back.

## The games

| Game | Players | Rules |
| --- | --- | --- |
| Tic-tac-toe | 2 | Three in a row on a board of three by three. X begins |
| Four in a row | 2 | Discs fall to the lowest free place of a column. Four in a row in any direction |
| Nine men's morris | 2 | Nine men each: place them, then move them along the lines. A mill (three in a row) takes a man of the other player, men in a mill are safe while others stand free. With three men left they jump. Fewer than three men or no move loses. 60 moves without a man taken are a draw. White begins: click a point to place, click a man and then a point to move |
| The matchstick game | 2 | 15 matches, take one to three in turn. Whoever takes the last match loses |
| Pig | 2 to 4 | Roll a die as often as you like and add the pips, or hold to bank them. A one loses the turn. First to the goal (setting, 50 by default). The table names who rolled the one, and a line under the goal tells how the last turn ended: the rolls and the banked sum, or the rolls up to the one |
| Ship, captain and crew | 2 to 4 | Three throws of five dice. A six (ship), a five (captain) and a four (crew) are set aside in this order. Once all three are aboard, the other two dice are the cargo: throw them again or keep them. Everyone has one turn, the richest cargo wins, equal cargo shares the win. A line tells how the last turn ended: the cargo and its dice, or no crew found |
| Liar's dice | 2 to 4 | Five dice each under a cup, everyone sees only their own. Bid how many dice of one face lie on the whole table, always higher than before (more dice, or as many of a higher face), or call the last bid a lie. The cups are lifted: when the bid holds the caller loses a die, else the bidder. The loser begins the next round. The last one with dice wins. A dimmed box below shows the lifted cups of the round before, with the bid and its face in one sentence. It is marked as the last round and folds to one line once the new round has its first bid, a click opens it again |
| Twenty-one | 1 to 4 | Against the house. Aces count 1 or 11, faces 10. The dealer draws to 17. Closer to 21 without going over wins, the same total is a tie |

## The regulars

| Regular | Plays |
| --- | --- |
| Old Bertram | easy going: mostly random, but no fool |
| Mirela the Quick | sharp: takes every win and blocks every threat |
| Jasper One Eye | unbeatable: perfect play at tic-tac-toe and the matchstick game, looks five moves ahead at four in a row and three at nine men's morris, takes risks at Pig when behind, weighs the odds of every bid at liar's dice and bluffs now and then, drops anchor at ship, captain and crew when the cargo beats the others |

Greta the innkeeper deals twenty-one.

The regulars wait a moment before each move, so everyone can follow. At Pig and at ship, captain and crew they take a little longer per roll (1.2 seconds instead of 0.9).

## Settings

The gear in the tavern's title bar opens the tavern settings. The GM also finds them as *Tavern settings* in the module settings. A player sees only the module language there.

| Setting | What it does |
| --- | --- |
| Games on offer | The games a new table can be opened for (GM). Tables already running are played to the end, a game switched off has no *Play again*. With no game on offer the tavern says so and has no *New table* |
| Module language | Follow Foundry, German or English, for you |
| Chat messages | Invitations and results, only results, or none |
| Suggestion for the break | A pause suggests a game to the players (GM, on by default). The button in the tavern always works |
| Goal in Pig | The score that wins a game of Pig (20 to 100) |
| Self test | Every game plays a round against itself (GM) |
| Save debug file | One file for bug reports about all of Sephral’s modules (GM). See [Debug file](#debug-file) |

## Debug file

For bug reports, the GM saves one file about all of Sephral’s modules in this world: `Save debug file` in the module settings, or `Save Debug File (Sephral’s Modules)` in the context menu of a chat message. It holds the versions of Foundry, the system and the active modules, the settings of the modules and what they recorded, for the tavern the tables in short (game, status, round, whose turn and who sits there), the games on offer and the GM who runs the tables. Hidden dice and the dealer's face down card never go into it. Macros call `game.modules.get("sephrals-tavern-games").api.saveDebugFile()`.

The file contains chat text and whispers. Check it before you share it.

## Sephral’s Modules

The first button in the module settings, *Sephral’s Modules* (GMs only), opens one window for all of Sephral's modules in the world: the version, self test, settings, manual and demo video of each, a button that switches on an installed module that is off (Foundry then reloads the world for everyone), and the debug file. Below, *More from Sephral* lists other modules that fit the game system of the world, shown only after a click, each with its demo video and an *Install* button. Foundry installs modules only on its setup screen, so the button copies the module's link (manifest URL) and shows the steps with a short clip. When the GM launches the world again, the window opens once with the new module and its *Enable* button. The list is part of the module. Only a video you start is loaded, from the module page on GitHub.

## Usage statistics

The module can take part in a small usage report shared by all of Sephral’s modules. Nothing is counted or sent until the GM agrees: shortly after the world starts, the active GM is asked, and the question comes back at every start until there is an answer. The answer counts for all of Sephral’s modules in the world. *Share usage statistics* in the module settings turns the report on or off at any time, and *Manage statistics* below it shows what the report contains right now.

With the GM’s consent only the active GM’s browser counts, and it sends at most one report a day. The counts are kept in a hidden world setting, so all browsers and computers of the GM count together, and turning the statistics off deletes them. A copy of a world gets its own world ID. The question lists everything the report contains, from the Foundry version to a random world ID. For Tavern Games it holds:

* on how many of the last 30 days the module was used
* how often each game is started (one number per game)
* how often the GM makes a suggestion for the break and how often a player takes one up
* the settings *Chat messages*, *Goal in Pig* and *Suggestion for the break* (only the chosen option)
* where errors occur in the module code: file, line, error type and whether the error arose in the module itself, in Foundry, in the game system or in another module, never the error message or the name of another module

No names, chat messages, notes, dice results or other content of the world are sent.

## How it runs

* The active GM's client runs every table. Players send their moves over the module socket. The server names the sender, so nobody can move for somebody else.
* The games switched off are kept in a world setting, so a game of a later version is on offer at once.
* The suggestion (`offer`), the number of games started per game (`played`) and the players who finished their first game (`introduced`) are world settings written by the active GM's client.
* The tables are kept in a world setting, so everyone sees the same table and a reload changes nothing. The last eight finished tables stay in the list.
* The dealer's face down card in twenty-one never leaves the GM's client until the players are done. At liar's dice nobody's dice go into the shared tables: every player asks the GM's client for their own dice. If the GM reloads, the cups are shaken again and everyone gets new dice for the round. If the GM reloads in the middle of a hand, a new face down card is dealt from the cards nobody has seen.
* Dice and cards use Foundry's random numbers.

## API

`game.modules.get("sephrals-tavern-games").api` offers `open({tableId})`, `settings()` (the tavern settings), `request(action, payload)` with the actions `create`, `join`, `addGuest`, `start`, `move`, `rematch`, `leave`, `close` and, for the suggestion for the break, `suggestJoin` and `suggest` and `suggestEnd` (GM), `suggest()` and `endSuggestion()` as shortcuts for the GM, `offer()` (the suggestion running now), `tables()`, the `games` and `guests`, `runSelfTest()` and `saveDebugFile()` (see [Debug file](#debug-file)).

## Limits

* A GM has to be online for the tables.
* There are no stakes: the games are played for honor and bragging rights.
