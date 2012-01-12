Game = Sky.Collection('games');
// {
//  board: ['A','I',...],
// }

Word = Sky.Collection('words');
// {game_id: 123, word: 'hello', valid: true, score: 5}

Player = Sky.Collection('players');
// {name: 'matt', current_game_id: 123}

// 6 faces per die, 16 dice.  Q really means Qu.
var DICE = ['PCHOAS', 'OATTOW', 'LRYTTE', 'VTHRWE',
            'EGHWNE', 'SEOTIS', 'ANAEEG', 'IDSYTT',
            'MTOICU', 'AFPKFS', 'XLDERI', 'ENSIEU',
            'YLDEVR', 'ZNRNHL', 'NMIQHU', 'OBBAOJ'];

// board is an array of length 16, in row-major order.  ADJACENCIES
// lists the board positions adjacent to each board position.
var ADJACENCIES = [
  [1,4,5],
  [0,2,4,5,6],
  [1,3,5,6,7],
  [2,6,7],
  [0,1,5,8,9],
  [0,1,2,4,6,8,9,10],
  [1,2,3,5,7,9,10,11],
  [2,3,6,10,11],
  [4,5,9,12,13],
  [4,5,6,8,10,12,13,14],
  [5,6,7,9,11,13,14,15],
  [6,7,10,14,15],
  [8,9,13],
  [8,9,10,12,14],
  [9,10,11,13,15],
  [10,11,14]
];

// generate a new random selection of letters.
var new_board = function () {
  var board = [];
  var i;

  // pick random letter from each die
  for (i = 0; i < 16; i += 1) {
    board[i] = DICE[i].split('')[Math.floor(Math.random() * 6)];
  }

  // knuth shuffle
  for (i = 15; i > 0; i -= 1) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = board[i];
    board[i] = board[j];
    board[j] = tmp;
  }

  return board;
}

// return true if word can be formed by hopping vertical, diagonal, or
// horizontally one space between letters on the given board, without
// repeating a tile.
var validate_word_against_board = function (board, word) {
  // recursive helper function.  word contains the remaining
  // unprocessed word -- this invocation is concerned with the first
  // letter of that word.  path is an ordered array of tile ids that
  // have been used so far by the earlier letters in the word.
  // adjacents are the available tiles to be used in this round.
  //
  // returns true if it finds a complete path at the bottom of the
  // recursion, and false if this particular path didn't pan out.  any
  // valid path makes the word valid, and once one is found it won't
  // bother to search any more.

  var check = function (board, word, path, adjacents) {
    // bottom of recursion
    if (word.length === 0)
      return true;

    // check each adjacent tile for something with the correct letter.
    // if there's a match, depth-first search it, and if it returns
    // true, bubble that result all the way to the top.  if none of
    // the candidate tiles checks out, then this partial path is a
    // dead end.  return false.
    for (var i = 0; i < adjacents.length; i += 1) {
      var tile = adjacents[i];
      if (board[tile] === word[0] && path.indexOf(tile) === -1)
        if (check(board,
                  word.slice(1),       // cdr of word
                  path.concat([tile]), // append matching location to path
                  ADJACENCIES[tile]))  // only look surrounding tiles
          return true;
    }

    return false;
  };

  // start off w/ full word, empty path, and all tiles available;
  return check(board, word, [], [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
};

Word.api({
  score: function (word) {
    var game = Game.find(word.game_id);
    var score;

    // must be at least three chars long
    if (word.word.length < 3) {
      Word.update(word._id, {$set: {score: 0, state: 'bad'}});
      return;
    }

    // disallow dups
    if (Word.find({game_id: word.game_id, word: word.word}).length > 1) {
      Word.update(word._id, {$set: {score: 0, state: 'bad'}});
      return;
    }

    // must be possible given board
    if (!validate_word_against_board(game.board, word.word)) {
      Word.update(word._id, {$set: {score: 0, state: 'bad'}});
      return;
    }

    // now only on the server, check against dictionary and score it.
    if (Sky.is_server) {
      if (DICTIONARY.indexOf(word.word.toLowerCase()) === -1) {
        Word.update(word._id, {$set: {score: 0, state: 'bad'}});
        return;
      }

      var score = Math.pow(2, word.word.length - 3);
      Word.update(word._id, {$set: {score: score,
                                    state: 'good'}});
    }
  }
});

if (Sky.is_server) {
  Sky.publish('players');
  Sky.publish('games');

  // only publish words that the server has scored.
  Sky.publish('words', {
    selector: function (game_id) {
      return {game_id: game_id, state: {$in: ['good','bad']}};
    }
  });
}
