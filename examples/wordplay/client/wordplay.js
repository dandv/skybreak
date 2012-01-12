// wordplay is a bit different from boggle.  first player to guess
// each word gets the point, one point per letter, min three letters
// in a word.  game state is the board, plus an object mapping each
// possible word to the player that got it, plus a denormalized score,
// or possibly breaking words out into a separate collection.

// lobby displays list of active players that aren't in a game.  how
// can i tell that?  players manage their own lobby membership, that's
// how.  so there's a lobby collection and players add their {name,id}
// pairs to it, and remove themselves.

// in the lobby, you can invite users to a new game by clicking their
// names and then clicking "play <n> person game".  this creates a new
// game, but w/o a board.  if you don't invite anyone, you can just
// play a solo game.

// clients sub to the list of game documents that they are part of.
// when anyone creates a game, they add the list of players to the
// game, and that pops up an "accept invitation" button on the lobby
// screen.

// if a player accepts an invitation, they remove themselves from the
// lobby and flag themselves in the game as accepted.  that redraws
// the screen to the show the accepted game in the foreground.

// 10 seconds after a client initiates a game, it starts the game.
// pending players are dropped if they haven't yet accepted.  starting
// them game probably means a raw handler creates the board and
// initializes everyone's score and wordlist.

// during the game play, each client adds words by entering them in a
// text box, and either hitting RET or clicking the "add" button.  the
// client calls a raw handler that adds the word to the wordlist,
// checks it against the dict, and increments the score.  the local
// version of the handler skips the dictionary check and score update.
// down the line, we can replace the raw handler w/ a validation.
// might want words as a separate collection.

// at the end of the game, client managing the clock sets game state
// to over.  server won't accept any more words if the game is over.
// everyone's screen freezes, input goes away, and we show the winner,
// and a button to go back to the lobby.

// could have server publish all possible words at the end of the
// round, also.  should probably attach dictionary to board at the
// start, and show how we can exclude it from the client subscription.

var my_player = function () {
  return Session.get('player_id') && Player.find(Session.get('player_id'));
};

var in_game = function () {
  return !!Session.get('game_id');
};

var my_game = function () {
  var game_id = Session.get('game_id');
  return game_id && Game.find(game_id);
};

var create_my_player = function (name) {
  if (!name)
    return;

  p = Player.insert({name: name});
  Session.set('player_id', p._id);

  // run a live query on any games i'm involved in, so that we can
  // drive changes in the session state.  this decouples the reactive
  // templates that depend on game_id and game_state from the frequent
  // DB updates to the game object itself.
  Game.findLive({players: p._id}, {
    added: function (game) {
      Session.set('game_id', game._id);
      Session.set('game_state', game.state);
    },
    changed: function (game) {
      Session.set('game_id', game._id);
      Session.set('game_state', game.state);
    },
    removed: function (id) {
      Session.set('game_id', null);
      Session.set('game_state', null);
    }
  });

  // kill my bad words after 5 seconds.
  Word.findLive({player_id: Session.get('player_id'), state: 'bad'},
                {added: function (word) {
                  setTimeout(function () {
                    $('#word_' + word._id).fadeOut(1000, function () {
                      Word.remove(word._id);
                    });
                  }, 5000);
                }});
};

var submit_word = function (text) {
  var obj = {player_id: my_player()._id,
             game_id: my_game()._id,
             word: text.toUpperCase(),
             state: 'pending'};

  var word = Word.insert(obj);
  Word.score(word);
};

var start_new_game = function (evt) {
  // create a new game w/ fresh board
  var game = Game.insert({board: new_board(),
                          state: 'in-progress',
                          clock: 120});

  // add everyone in the lobby to the game
  var players = Player.find({current_game_id: null});
  var player_ids = players.map(function (p) {return p._id});

  Game.update(game._id, {$set: {players: player_ids}});

  // and remove them from the lobby
  Player.update({_id: {$in: player_ids}},
                {$set: {current_game_id: game._id}});

  // drive a 2 minute game timer down to 0.  at the end, kill the
  // timer and set the game state to complete.
  var timer = setInterval(function () {
    Game.update({_id: game._id, clock: {$gt : 0}},
                {$inc: {clock : -1}});

    var g = Game.find({_id: game._id})[0];
    if (g.clock === 0) {
      Game.update(g._id, {$set: {state: 'finished'}});
      clearInterval(timer);
    }
  }, 1000);
};

//////
////// login template: gathers player's name and creates player
//////

Template.login.show = function () {
  return !my_player();
};

Template.login.events = {
  'click button': function (evt) {
    create_my_player($('#login input').val());
  },
  'keypress input': function (evt) {
    if (13 === evt.which)
      create_my_player($('#login input').val());
  }
};

//////
////// lobby template: shows everyone not currently playing, and
////// offers a button to start a fresh game.
//////

Template.lobby.show = function () {
  return my_player() && !in_game();
};

Template.lobby.waiting = function () {
  return Player.find({current_game_id: null});
};

Template.lobby.ready_to_play = function () {
  var players = Player.find({current_game_id: null});

  return (players.length
          + ' player' + (players.length === 1 ? '' : 's')
          + ' waiting to play');
};

Template.lobby.events = {
  'click button.startgame': start_new_game
};

//////
////// board template: renders the board and the clock given the
////// current game.  if there is no game, show a splash screen.
//////
var SPLASH = ['','','','',
              'W', 'O', 'R', 'D',
              'P', 'L', 'A', 'Y',
              '','','',''];

Template.board.square = function (i) {
  var game = my_game();
  return game && game.board && game.board[i] || SPLASH[i];
};

Template.board.clock = function () {
  var clock = my_game() && my_game().clock;
  if (!clock) return;

  // format into M:SS
  var min = Math.floor(clock / 60);
  var sec = clock % 60;
  return min + ':' + (sec < 10 ? ('0' + sec) : sec);
};

Template.board.events = {
  'click .square': function (evt) {
    var textbox = $('#scratchpad input');
    textbox.val(textbox.val() + evt.target.innerHTML);
    textbox.focus();
  }
};

//////
////// scratchpad is where we enter new words.
//////

Template.scratchpad.show = function () {
  return Session.equals('game_state', 'in-progress');
};

Template.scratchpad.events = {
  'click button': function (evt) {
    var textbox = $('#scratchpad input');
    submit_word(textbox.val());
    textbox.val('');
    textbox.focus();
  },
  'keypress input': function (evt) {
    if (13 === evt.which) {
      var textbox = $('#scratchpad input');
      submit_word(textbox.val());
      textbox.val('');
      textbox.focus();
    }
  }
};

Template.postgame.show = function () {
  return Session.equals('game_state', 'finished');
};

Template.postgame.events = {
  'click button': function (evt) {
    Game.update(my_game()._id, {$pull: {players: my_player()._id}});
    Player.update(my_player()._id, {$set: {current_game_id: null}});
  }
}

//////
////// scores shows everyone's score and word list.
//////

Template.scores.show = function () {
  return in_game();
};

Template.scores.players = function () {
  if (!in_game())
    return;

  return Player.find({current_game_id: my_game()._id});
};

Template.words.words = function () {
  return Word.find({game_id: my_game()._id,
                    player_id: this._id});
};

Template.words.total_score = function () {
  var words = Word.find({game_id: my_game()._id,
                         player_id: this._id});

  var score = 0;
  for (var i = 0; i < words.length; i++)
    if (words[i].score)
      score += words[i].score

  return score;
};

// at startup, subscribe to all the players and games, and all the
// words in whatever game i'm currently playing.

Sky.startup(function () {
  Sky.subscribe('games');
  Sky.subscribe('players');

  Sky.autosubscribe(function () {
    if (in_game())
      Sky.subscribe('words', my_game()._id);
  });
});