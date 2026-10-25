# Sephral’s Tavern Games: Manual

## The tavern

Open the tavern from the token controls on the left (mug icon) or with the button of a tavern chat message. The tables are on the left, the chosen table on the right. Everyone sees every table and can watch. The gear in the title bar opens the tavern settings.

* **New table:** pick the game and an opponent. The dialog shows the guide of the chosen game. Against a regular the game starts right away (games for more players with two seats). *Wait for other players* opens the table and posts an invitation in the chat. Whoever clicks *Join* sits down.
* **More seats:** Pig, liar's dice and ship, captain and crew take two to four players, twenty-one one to four. The host can invite regulars to free seats (not at twenty-one) and starts the game with *Start*.
* **Your turn:** the line under the title says whose turn it is. When the tavern is closed and your turn comes, a notification tells you.
* **Buttons:** the players at a table see the buttons of the game (roll, hold, take, card, bid and so on), greyed out while it is somebody else's turn. Spectators and whoever left the table see the board without buttons.
* **Play again:** after a game, *Play again* starts a new round with the same seats. In games for two, the other one begins.
* **Guide:** every game has a short guide in the tongue of old. It shows while a table waits, the scroll next to the game's name shows it during the game.
* **Leave:** leaving a waiting table frees the seat (the host takes the table away). Leaving a running game loses it. In the games for more players (Pig, liar's dice, ship, captain and crew, twenty-one) the others play on without whoever left, as long as another player sits at the table or anybody still plays against the house (twenty-one). A regular never plays on alone. *Play again* leaves out whoever left.
* **Take the table away:** the host or the GM removes a table.

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
| Goal in Pig | The score that wins a game of Pig (20 to 100) |
| Self test | Every game plays a round against itself (GM) |

## Usage statistics

The module can take part in a small usage report shared by all of Sephral’s modules. Nothing is counted or sent until the GM agrees: shortly after the world starts, the active GM is asked, and the question comes back at every start until there is an answer. The answer counts for all of Sephral’s modules in the world. *Share usage statistics* in the module settings turns the report on or off at any time, and *Manage statistics* below it shows what the report contains right now.

With the GM’s consent only the active GM’s browser counts, and it sends at most one report a day. The question lists everything the report contains, from the Foundry version to a random world ID. For Tavern Games it holds:

* on how many of the last 30 days the module was used
* how often each game is started (one number per game)
* the settings *Chat messages* and *Goal in Pig* (only the chosen option)
* where errors occur in the module code: file, line and error type, never the error message

No names, chat messages, notes, dice results or other content of the world are sent.

## How it runs

* The active GM's client runs every table. Players send their moves over the module socket. The server names the sender, so nobody can move for somebody else.
* The games switched off are kept in a world setting, so a game of a later version is on offer at once.
* The tables are kept in a world setting, so everyone sees the same table and a reload changes nothing. The last eight finished tables stay in the list.
* The dealer's face down card in twenty-one never leaves the GM's client until the players are done. At liar's dice nobody's dice go into the shared tables: every player asks the GM's client for their own dice. If the GM reloads, the cups are shaken again and everyone gets new dice for the round. If the GM reloads in the middle of a hand, a new face down card is dealt from the cards nobody has seen.
* Dice and cards use Foundry's random numbers.

## API

`game.modules.get("sephrals-tavern-games").api` offers `open({tableId})`, `settings()` (the tavern settings), `request(action, payload)` with the actions `create`, `join`, `addGuest`, `start`, `move`, `rematch`, `leave` and `close`, `tables()`, the `games` and `guests`, and `runSelfTest()`.

## Limits

* A GM has to be online for the tables.
* There are no stakes: the games are played for honor and bragging rights.
