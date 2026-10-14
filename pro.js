/* pro.js - UI/UX layer. Loaded by boot.js after the game exists (window.game).
 * Everything here talks to the game through its public hooks:
 *   game.onStateChange / onGameplay / onPause / onResume / onComplete / onCompleteDismiss
 *   game.controls.onHistoryChange, game.pause(), game.resume(), game.restart(), game.startDaily()
 */
( function () {

  'use strict';

  var game = window.game, TC = window.TheCube, STATE = TC.STATE, engine = TC.engine;
  var Platform = window.Platform, SafeStorage = window.SafeStorage;
  var $ = function ( id ) { return document.getElementById( id ); };

  var root = $( 'pro' );
  var STATE_NAMES = {}; Object.keys( STATE ).forEach( function ( k ) { STATE_NAMES[ STATE[ k ] ] = k.toLowerCase(); } );

  /* ---------------------------------------------------------------- icons */
  var ICONS = {
    soundOn: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>',
    fsEnter: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    fsExit: '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
    help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17h.01"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
  };

  /* ---------------------------------------------------------------- audio */
  // Tiny synthesized effects: no asset files, no external requests. The AudioContext is created
  // on the first user gesture (browser autoplay rules).
  var Sfx = ( function () {

    var ctx = null, master = null;
    var enabled = SafeStorage.getItem( 'theCube_sound' ) !== 'off';
    var mutes = {};   // reasons the game is silenced (hidden tab, ad playing)

    function silent() { return ! enabled || Object.keys( mutes ).some( function ( k ) { return mutes[ k ]; } ); }

    function ensure() {
      if ( ctx ) return ctx;
      var AC = window.AudioContext || window.webkitAudioContext;
      if ( ! AC ) return null;
      try { ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.5; master.connect( ctx.destination ); } catch ( e ) { ctx = null; }
      return ctx;
    }

    function tone( freq, dur, type, vol, slideTo, delay ) {
      if ( silent() || ! ensure() ) return;
      if ( ctx.state === 'suspended' ) ctx.resume();
      var t = ctx.currentTime + ( delay || 0 );
      var osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime( freq, t );
      if ( slideTo ) osc.frequency.exponentialRampToValueAtTime( slideTo, t + dur );
      gain.gain.setValueAtTime( 0.0001, t );
      gain.gain.exponentialRampToValueAtTime( vol || 0.2, t + 0.01 );
      gain.gain.exponentialRampToValueAtTime( 0.0001, t + dur );
      osc.connect( gain ); gain.connect( master );
      osc.start( t ); osc.stop( t + dur + 0.02 );
    }

    return {
      get enabled() { return enabled; },
      unlock: function () { if ( ! silent() && ensure() && ctx.state === 'suspended' ) ctx.resume(); },
      setEnabled: function ( on ) { enabled = !! on; SafeStorage.setItem( 'theCube_sound', on ? 'on' : 'off' ); if ( on ) tone( 660, 0.08, 'sine', 0.15 ); },
      setMuted: function ( reason, on ) { mutes[ reason ] = !! on; if ( ctx ) { if ( on && ctx.state === 'running' ) ctx.suspend(); else if ( ! on && ! silent() ) ctx.resume(); } },
      click: function () { tone( 520, 0.05, 'triangle', 0.12 ); },
      move: function () { tone( 240, 0.07, 'square', 0.07, 150 ); },
      undo: function () { tone( 380, 0.08, 'triangle', 0.12, 260 ); },
      solve: function () { [ 523, 659, 784, 1047 ].forEach( function ( f, i ) { tone( f, 0.22, 'triangle', 0.18, null, i * 0.11 ); } ); },
      record: function () { [ 1047, 1319, 1568 ].forEach( function ( f, i ) { tone( f, 0.18, 'sine', 0.14, null, 0.5 + i * 0.09 ); } ); },
    };

  } )();

  /* ---------------------------------------------------------------- helpers */
  var toastTimer = null;
  function toast( msg, kind, ms ) {
    var el = $( 'pro-toast' );
    el.textContent = msg;
    el.className = 'pro-toast pro-layer show' + ( kind ? ' is-' + kind : '' );
    clearTimeout( toastTimer );
    toastTimer = setTimeout( function () { el.classList.remove( 'show' ); }, ms || 2400 );
  }

  function fmt( ms ) {
    var s = Math.floor( ms / 1000 ) % 60, m = Math.floor( ms / 60000 );
    return m + ':' + ( s < 10 ? '0' : '' ) + s;
  }

  function sizeLabel() { var s = game.cube.sizeGenerated; return s + 'x' + s + ' cube'; }

  /* ---------------------------------------------------------------- modal handling */
  var openModal = null, lastFocus = null;

  function showModal( el, focusId ) {
    if ( openModal && openModal !== el ) hideModal( openModal, true );
    lastFocus = document.activeElement;
    el.hidden = false;
    openModal = el;
    var f = focusId && $( focusId );
    var card = el.querySelector( '.pro-card' );
    if ( f ) f.focus( { preventScroll: true } );   // focusing a button at the bottom must not scroll the card
    if ( card ) card.scrollTop = 0;
  }

  function hideModal( el, keepFocus ) {
    el.hidden = true;
    if ( openModal === el ) openModal = null;
    if ( ! keepFocus && lastFocus && lastFocus.focus ) { try { lastFocus.focus(); } catch ( e ) {} }
  }

  // keep Tab inside the open dialog
  document.addEventListener( 'keydown', function ( e ) {
    if ( e.key !== 'Tab' || ! openModal ) return;
    var items = openModal.querySelectorAll( 'button:not([disabled])' );
    if ( ! items.length ) return;
    var first = items[ 0 ], last = items[ items.length - 1 ];
    if ( e.shiftKey && document.activeElement === first ) { e.preventDefault(); last.focus(); }
    else if ( ! e.shiftKey && document.activeElement === last ) { e.preventDefault(); first.focus(); }
  } );

  // Dialogs opened from the pause card replace it; closing them must bring it back, or the player
  // would be left paused with no Resume button.
  function backToPauseIfNeeded() {
    if ( game.paused && game.state === STATE.Playing && ! openModal ) showModal( $( 'pro-pause-ui' ), 'pro-resume' );
  }

  var confirmYes = null;
  function confirmDialog( title, text, yesLabel, onYes ) {
    $( 'pro-confirm-title' ).textContent = title;
    $( 'pro-confirm-text' ).textContent = text;
    $( 'pro-confirm-yes' ).firstElementChild.textContent = yesLabel || 'Yes';
    confirmYes = onYes;
    showModal( $( 'pro-confirm' ), 'pro-confirm-no' );
  }

  /* ---------------------------------------------------------------- HUD state */
  function applyState() {

    var name = STATE_NAMES[ game.state ] || 'menu';
    root.dataset.state = name;

    [].forEach.call( root.querySelectorAll( '[data-show]' ), function ( el ) {
      if ( el.id === 'pro-fs' && ! fsSupported() ) { el.hidden = true; return; }
      el.hidden = el.dataset.show.split( ' ' ).indexOf( name ) < 0;
    } );

    if ( name === 'menu' ) refreshMenu();
    if ( name !== 'playing' ) hideTip();

  }

  function refreshMenu() {

    var resumable = !! game.saved;
    $( 'pro-play-label' ).textContent = resumable ? 'Continue' : 'Play';
    $( 'pro-play-sub' ).textContent = resumable ? 'Unfinished ' + sizeLabel() : sizeLabel();

    var best = game.getDailyBest();
    $( 'pro-daily-sub' ).textContent = best ? 'Today\'s best ' + fmt( best.best ) + ' / ' + best.moves + ' moves' : 'Same scramble for everyone today';

  }

  function updateMoves( reason ) {

    var h = game.controls, n = h.history.length, el = $( 'pro-moves' );
    el.textContent = n;
    $( 'pro-undo' ).disabled = ! h.canUndo();
    $( 'pro-redo' ).disabled = ! h.canRedo();

    if ( reason === 'move' || reason === 'undo' || reason === 'redo' ) {
      el.classList.remove( 'bump' ); void el.offsetWidth; el.classList.add( 'bump' );
      reason === 'move' ? Sfx.move() : Sfx.undo();
      if ( reason === 'move' ) hideTip();
    }

  }

  /* ---------------------------------------------------------------- tip (first run) */
  function showTip() {
    if ( SafeStorage.getItem( 'theCube_tipSeen' ) === '1' ) return;
    var touch = window.matchMedia && window.matchMedia( '(pointer: coarse)' ).matches;
    $( 'pro-tip-text' ).textContent = touch
      ? 'Drag a face to turn it. Drag the background to rotate the cube.'
      : 'Drag a face to turn it, or use U D L R F B. Z undoes a move.';
    $( 'pro-tip' ).hidden = false;
    clearTimeout( showTip.t ); showTip.t = setTimeout( hideTip, 9000 );
  }
  function hideTip() {
    if ( $( 'pro-tip' ).hidden ) return;
    $( 'pro-tip' ).hidden = true;
    SafeStorage.setItem( 'theCube_tipSeen', '1' );
  }

  /* ---------------------------------------------------------------- actions */
  function canAct() { return game.transition.activeTransitions === 0; }

  function play() {
    if ( game.state !== STATE.Menu || ! canAct() ) return;
    Sfx.unlock(); Sfx.click();
    game.game( true );
  }

  function daily() {
    if ( game.state !== STATE.Menu || ! canAct() ) return;
    Sfx.unlock(); Sfx.click();
    var start = function () { if ( game.startDaily() ) toast( 'Daily challenge ' + game.daily.date + ' (' + sizeLabel() + ')' ); };
    if ( game.saved ) confirmDialog( 'Start the daily challenge?', 'Your unfinished solve will be discarded.', 'Start', function () { hideModal( $( 'pro-confirm' ), true ); start(); } );
    else start();
  }

  function pauseGame( reason ) {
    if ( game.pause( reason ) ) {
      $( 'pro-pause-time' ).textContent = game.timer.converted;
      $( 'pro-pause-moves' ).textContent = game.controls.history.length;
      showModal( $( 'pro-pause-ui' ), 'pro-resume' );
    }
  }

  function resumeGame() {
    if ( openModal === $( 'pro-confirm' ) ) hideModal( openModal, true );
    hideModal( $( 'pro-pause-ui' ) );
    Sfx.unlock();
    game.resume();
  }

  function togglePause() {
    if ( game.paused ) resumeGame();
    else if ( game.state === STATE.Playing && ! openModal ) { Sfx.click(); pauseGame( 'user' ); }
  }

  function toggleSound() {
    Sfx.setEnabled( ! Sfx.enabled );
    renderSound();
  }

  function renderSound() {
    var b = $( 'pro-sound' );
    b.innerHTML = Sfx.enabled ? ICONS.soundOn : ICONS.soundOff;
    b.setAttribute( 'aria-pressed', String( Sfx.enabled ) );
    b.setAttribute( 'aria-label', Sfx.enabled ? 'Sound on' : 'Sound off' );
  }

  function openHelp() {
    if ( game.state === STATE.Playing && ! game.paused ) pauseGame( 'help' );
    showModal( $( 'pro-help-ui' ), 'pro-help-close' );
  }

  function closeHelp() {
    hideModal( $( 'pro-help-ui' ), game.paused );
    backToPauseIfNeeded();
  }

  function closeConfirm() {
    hideModal( $( 'pro-confirm' ), game.paused );
    confirmYes = null;
    backToPauseIfNeeded();
  }

  /* fullscreen (only offered where the browser/host allows it) */
  function fsSupported() { return !! ( document.fullscreenEnabled || document.webkitFullscreenEnabled ); }
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
  function toggleFullscreen() {
    if ( ! fsSupported() ) return;
    try {
      if ( fsElement() ) ( document.exitFullscreen || document.webkitExitFullscreen ).call( document );
      else { var el = document.documentElement; ( el.requestFullscreen || el.webkitRequestFullscreen ).call( el ); }
    } catch ( e ) { toast( 'Fullscreen is not available here', 'warn' ); }
  }
  function renderFs() {
    var b = $( 'pro-fs' ), on = !! fsElement();
    b.innerHTML = on ? ICONS.fsExit : ICONS.fsEnter;
    b.setAttribute( 'aria-label', on ? 'Exit fullscreen' : 'Fullscreen' );
  }

  /* quality */
  function renderQuality() {
    [].forEach.call( $( 'pro-quality' ).querySelectorAll( 'button' ), function ( b ) {
      b.setAttribute( 'aria-pressed', String( b.dataset.q === game.world.quality ) );
    } );
  }

  /* ---------------------------------------------------------------- wiring */
  function bind() {

    $( 'pro-sound' ).innerHTML = ''; renderSound(); renderFs();
    $( 'pro-help' ).innerHTML = ICONS.help;
    $( 'pro-pause' ).innerHTML = ICONS.pause;
    $( 'pro-undo' ).innerHTML = ICONS.undo;
    $( 'pro-redo' ).innerHTML = ICONS.redo;

    $( 'pro-play' ).addEventListener( 'click', play );
    $( 'pro-daily' ).addEventListener( 'click', daily );
    $( 'pro-pause' ).addEventListener( 'click', togglePause );
    $( 'pro-sound' ).addEventListener( 'click', toggleSound );
    $( 'pro-fs' ).addEventListener( 'click', toggleFullscreen );
    $( 'pro-help' ).addEventListener( 'click', openHelp );
    $( 'pro-help-close' ).addEventListener( 'click', closeHelp );
    $( 'pro-tip-close' ).addEventListener( 'click', hideTip );
    $( 'pro-undo' ).addEventListener( 'click', function () { game.controls.undo(); } );
    $( 'pro-redo' ).addEventListener( 'click', function () { game.controls.redo(); } );
    $( 'pro-resume' ).addEventListener( 'click', resumeGame );

    $( 'pro-restart' ).addEventListener( 'click', function () {
      confirmDialog( 'Start a new scramble?', 'Your current solve will be lost.', 'New scramble', function () {
        hideModal( $( 'pro-confirm' ), true );
        hideModal( $( 'pro-pause-ui' ), true );
        game.resume();
        if ( ! game.restart() ) toast( 'Please wait a moment and try again', 'warn' );
      } );
    } );

    $( 'pro-quit' ).addEventListener( 'click', function () {
      hideModal( $( 'pro-pause-ui' ), true );
      game.resume();
      if ( canAct() ) game.game( false );
    } );

    $( 'pro-confirm-no' ).addEventListener( 'click', closeConfirm );
    $( 'pro-confirm-yes' ).addEventListener( 'click', function () { var f = confirmYes; confirmYes = null; if ( f ) f(); } );

    $( 'pro-quality' ).addEventListener( 'click', function ( e ) {
      var q = e.target && e.target.dataset && e.target.dataset.q;
      if ( ! q ) return;
      game.world.setQuality( q );
      game.storage.savePreferences();
      renderQuality();
      Sfx.click();
    } );

    // sound for the original game buttons too
    [].forEach.call( document.querySelectorAll( '.ui .btn' ), function ( b ) { b.addEventListener( 'click', function () { Sfx.unlock(); Sfx.click(); } ); } );
    document.addEventListener( 'pointerdown', function () { Sfx.unlock(); }, { once: true, passive: true } );

    document.addEventListener( 'fullscreenchange', renderFs );
    document.addEventListener( 'webkitfullscreenchange', renderFs );

    renderQuality();

  }

  /* ---------------------------------------------------------------- keyboard */
  var FACES = { u: 'U', d: 'D', l: 'L', r: 'R', f: 'F', b: 'B' };
  var ARROWS = { ArrowLeft: [ 'y', -1 ], ArrowRight: [ 'y', 1 ], ArrowUp: [ 'x', -1 ], ArrowDown: [ 'x', 1 ] };

  document.addEventListener( 'keydown', function ( e ) {

    if ( e.ctrlKey && e.key.toLowerCase() !== 'z' && e.key.toLowerCase() !== 'y' ) return;
    if ( e.altKey ) return;
    var key = e.key, k = key.length === 1 ? key.toLowerCase() : key;
    var playing = game.state === STATE.Playing;

    // modals first
    if ( openModal ) {
      if ( key === 'Escape' ) {
        e.preventDefault();
        if ( openModal === $( 'pro-help-ui' ) ) closeHelp();
        else if ( openModal === $( 'pro-confirm' ) ) closeConfirm();
        else if ( openModal === $( 'pro-pause-ui' ) ) resumeGame();
      }
      return;
    }

    if ( key === 'Escape' || k === 'p' ) { if ( playing ) { e.preventDefault(); togglePause(); } return; }
    if ( k === 'm' ) { toggleSound(); return; }
    if ( k === 'f' && ! playing ) { toggleFullscreen(); return; }
    if ( k === 'h' || key === '?' ) { openHelp(); return; }

    if ( game.state === STATE.Menu ) {
      if ( key === ' ' || key === 'Enter' ) { e.preventDefault(); play(); }
      return;
    }

    if ( ! playing || e.repeat ) return;

    if ( ( k === 'z' && ! e.shiftKey ) ) { e.preventDefault(); game.controls.undo(); return; }
    if ( k === 'y' || ( k === 'z' && e.shiftKey && ( e.ctrlKey || e.metaKey ) ) ) { e.preventDefault(); game.controls.redo(); return; }
    if ( e.ctrlKey || e.metaKey ) return;

    if ( FACES[ k ] ) {
      e.preventDefault();
      // Standard notation relative to the cube: Shift turns the face counter-clockwise.
      var move = game.scrambler.convertMove( FACES[ k ] + ( e.shiftKey ? '\'' : '' ) );
      game.controls.keyboardMove( 'LAYER', move );
      return;
    }

    if ( ARROWS[ key ] ) {
      e.preventDefault();
      game.controls.keyboardMove( 'CUBE', { axis: ARROWS[ key ][ 0 ], angle: ARROWS[ key ][ 1 ] * Math.PI / 2 } );
    }

  } );

  /* ---------------------------------------------------------------- visibility / focus */
  function onHidden() {
    Sfx.setMuted( 'hidden', true );
    if ( game.state === STATE.Playing && ! game.paused ) pauseGame( 'hidden' );
    engine.pause();                       // stop all rAF work while nobody can see it
    saveNow();
  }
  function onVisible() {
    Sfx.setMuted( 'hidden', false );
    engine.resume();
    game.world.invalidate();
    game.world.scheduleResize();
  }
  document.addEventListener( 'visibilitychange', function () { document.hidden ? onHidden() : onVisible(); } );
  window.addEventListener( 'blur', function () {
    // e.g. the player clicks the surrounding page or an ad frame: pause instead of silently running the clock
    if ( game.state === STATE.Playing && ! game.paused && ! document.hidden ) pauseGame( 'blur' );
  } );
  function saveNow() {
    try { if ( game.saved && game.state === STATE.Playing && game.controls.state === 0 && game.controls.scramble === null ) game.storage.saveGame(); } catch ( e ) {}
  }
  window.addEventListener( 'pagehide', function () { saveNow(); Platform.gameplay( false ); } );

  window.addEventListener( 'cube:contextlost', function () { toast( 'Graphics were interrupted. Restoring...', 'warn', 4000 ); } );
  window.addEventListener( 'cube:contextrestored', function () { toast( 'Graphics restored' ); } );
  window.addEventListener( 'cube:storage-unavailable', function () { toast( 'Progress can\'t be saved in this browser mode', 'warn', 4500 ); } );
  if ( ! SafeStorage.persistent ) setTimeout( function () { window.dispatchEvent( new CustomEvent( 'cube:storage-unavailable' ) ); }, 1500 );

  /* ---------------------------------------------------------------- game hooks */
  game.onStateChange = function ( state, old ) {
    applyState();
    if ( state === STATE.Playing ) { updateMoves(); showTip(); }
  };

  game.onGameplay = function ( active ) { Platform.gameplay( active ); };

  game.onPause = function () {};
  game.onResume = function () {};

  game.controls.onHistoryChange = updateMoves;

  game.onComplete = function ( solve ) {

    Sfx.solve();
    $( 'pro-result-moves' ).textContent = solve.moves + ( solve.moves === 1 ? ' move' : ' moves' );

    var extra = $( 'pro-result-extra' ), parts = [];
    extra.className = '';

    if ( solve.bestMoves && game.scores.data[ solve.size ].solves > 1 ) { parts.push( 'Fewest moves yet!' ); extra.className = 'is-record'; }
    if ( solve.daily ) {
      parts.push( solve.daily.newBest ? 'New daily best ' + fmt( solve.daily.best ) : 'Daily best ' + fmt( solve.daily.best ) );
      if ( solve.daily.newBest ) extra.className = 'is-record';
    }
    extra.textContent = parts.join(' | ');

    var personalBest = solve.best && game.scores.data[ solve.size ].solves > 1;
    if ( personalBest || ( solve.bestMoves && game.scores.data[ solve.size ].solves > 1 ) ) { Sfx.record(); }
    if ( personalBest ) Platform.happytime();

  };

  // Natural break: the player leaves the "Complete" screen. Request the (optional) midgame ad here.
  game.onCompleteDismiss = function () {
    Platform.requestMidgame( {
      started: function () { Sfx.setMuted( 'ad', true ); },
      finished: function () { Sfx.setMuted( 'ad', false ); game.world.invalidate(); },
    } );
  };

  /* ---------------------------------------------------------------- go */
  bind();
  applyState();
  updateMoves();

  var errorToastShown = false;
  window.Pro = {
    toast: toast, sfx: Sfx,
    reportError: function () {
      if ( errorToastShown ) return;
      errorToastShown = true;
      toast( 'Something went wrong. If the cube stops responding, reload the page.', 'warn', 5000 );
    },
  };

} )();
