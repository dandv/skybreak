var my_game = function () {
  return Session.get('game_id') && Game.find(Session.get('game_id'));
};

var create_my_player = function (name) {
  if (!name)
    return;

  p = Player.insert({name: name});
  Session.set('player_id', p._id);

  // run a live query on the game i'm involved in, so that we can
  // drive changes in the session state.  this decouples the reactive
  // templates that depend on game_id and game_state from the frequent
  // DB updates to the game object itself.

  Player.findLive({_id: p._id}, {
    changed: function (p) {
      if (!Session.equals('game_id', p.game_id)) {
        Session.set('game_id', p.game_id);

        if (p.game_id) {
          // in a new game.  start the clock.
          Session.set('clock', 120);

          var timer = setInterval(function () {
            var clock = Session.get('clock');
            if (clock > 0) {
              Session.set('clock', clock - 1);
            } else {
              clearInterval(timer);
              clear_selected_positions();
            }
          }, 1000);
        }
      }
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
  var obj = {player_id: Session.get('player_id'),
             game_id: Session.get('game_id'),
             word: text.toUpperCase(),
             state: 'pending'};

  var word = Word.insert(obj);
  Word.score(word);
};

var start_new_game = function (evt) {
  // create a new game w/ fresh board
  var game = Game.insert({board: new_board(),
                          state: 'running'});

  // add everyone in the lobby to the game
  Player.update({game_id: null},
                {$set: {game_id: game._id}});

  // as the game leader, i shut it down after 2 minutes.
  setTimeout(function () {
    Game.update(game._id, {$set: {state: 'finished'}});
  }, 120 * 1000);
};

var set_selected_positions = function (word) {
  var paths = paths_for_word(my_game().board, word.toUpperCase());
  var in_a_path = [];
  var last_in_a_path = [];

  for (var i = 0; i < paths.length; i++) {
    in_a_path = in_a_path.concat(paths[i]);
    last_in_a_path.push(paths[i].slice(-1)[0]);
  }

  for (var pos = 0; pos < 16; pos++) {
    if (last_in_a_path.indexOf(pos) !== -1)
      Session.set('selected_' + pos, 'last_in_path');
    else if (in_a_path.indexOf(pos) !== -1)
      Session.set('selected_' + pos, 'in_path');
    else
      Session.set('selected_' + pos, false);
  }
};

var clear_selected_positions = function () {
  for (var pos = 0; pos < 16; pos++)
    Session.set('selected_' + pos, false);
};

//////
////// login template: gathers player's name and creates player
//////

Template.login.show = function () {
  return !Session.get('player_id');
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
  return Session.get('player_id') && !Session.get('game_id');
};

Template.lobby.waiting = function () {
  return Player.find({game_id: null});
};

Template.lobby.ready_to_play = function () {
  var players = Player.find({game_id: null});

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

Template.board.selected = function (i) {
  return Session.get('selected_' + i);
};

Template.board.events = {
  'click .square': function (evt) {
    var textbox = $('#scratchpad input');
    textbox.val(textbox.val() + evt.target.innerHTML);
    textbox.focus();
  }
};

Template.clock.clock = function () {
  var clock = Session.get('clock');

  if (!clock || clock === 0)
    return;

  // format into M:SS
  var min = Math.floor(clock / 60);
  var sec = clock % 60;
  return min + ':' + (sec < 10 ? ('0' + sec) : sec);
};

//////
////// scratchpad is where we enter new words.
//////

Template.scratchpad.show = function () {
  return my_game() && my_game().state === 'running';
};

// wish we had a better pattern here.  this comes up all the time.
Template.scratchpad.events = {
  'click button': function (evt) {
    var textbox = $('#scratchpad input');
    submit_word(textbox.val());
    textbox.val('');
    textbox.focus();
    clear_selected_positions();
  },
  'keyup input': function (evt) {
    var textbox = $('#scratchpad input');
    if (13 === evt.which) {
      submit_word(textbox.val());
      textbox.val('');
      textbox.focus();
      clear_selected_positions();
    } else {
      set_selected_positions(textbox.val());
    }
  }
};

Template.postgame.show = function () {
  return my_game() && my_game().state === 'finished';
};

Template.postgame.events = {
  'click button': function (evt) {
    Player.update(Session.get('player_id'), {$set: {game_id: null}});
  }
}

//////
////// scores shows everyone's score and word list.
//////

Template.scores.show = function () {
  return !!Session.get('game_id');
};

Template.scores.players = function () {
  return Player.find({game_id: Session.get('game_id')});
};

Template.words.words = function () {
  return Word.find({game_id: Session.get('game_id'),
                    player_id: this._id});
};

Template.words.total_score = function () {
  var words = Word.find({game_id: Session.get('game_id'),
                         player_id: this._id});

  var score = 0;
  for (var i = 0; i < words.length; i++)
    if (words[i].score)
      score += words[i].score

  return score;
};

// at startup, subscribe to all the players, the game i'm in, and all
// the words in that game.

Sky.startup(function () {
  Sky.subscribe('players');

  Sky.autosubscribe(function () {
    if (Session.get('game_id')) {
      Sky.subscribe('games', Session.get('game_id'));
      Sky.subscribe('words', {game_id: Session.get('game_id'), player_id: Session.get('player_id')});
    }
  });
});