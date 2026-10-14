/* boot.js - startup, error handling, safe storage and the CrazyGames SDK wrapper.
 *
 * Load order:  boot.js -> (lib/three.min.js | CDN) -> main.js -> pro.js
 * Everything here is plain ES5-style JS so it still runs (and can show an error) on old browsers.
 */
( function () {

  'use strict';

  var CONFIG = window.GAME_CONFIG = {
    version: '1.0.0',
    // Three.js r95 is required by main.js. Put a copy at lib/three.min.js and it is used first,
    // so the published build makes no third-party requests except the CrazyGames SDK.
    threeLocal: 'lib/three.min.js',
    threeCdn: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/95/three.min.js',
    crazyGamesSdk: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
    ads: { enabled: true },       // midgame ad after a solve, only if the SDK is present
    sdkTimeoutMs: 6000,
    scriptTimeoutMs: 20000,
  };

  var $ = function ( id ) { return document.getElementById( id ); };
  var ready = false;
  var lastError = null;

  /* ------------------------------------------------------------------ */
  /* Safe storage: never throws (blocked cookies, sandboxed iframes,     */
  /* private mode, full quota). Falls back to memory for the session.    */
  /* ------------------------------------------------------------------ */
  var SafeStorage = window.SafeStorage = ( function () {

    var ls = null, usable = false, mem = {}, warned = false;

    try {
      ls = window.localStorage;
      var probe = '__cube_probe__';
      ls.setItem( probe, '1' );
      ls.removeItem( probe );
      usable = true;
    } catch ( e ) { ls = null; usable = false; }

    function warn() {
      if ( warned ) return;
      warned = true;
      try { window.dispatchEvent( new CustomEvent( 'cube:storage-unavailable' ) ); } catch ( e ) {}
    }

    if ( ! usable ) setTimeout( warn, 0 );

    return {
      get persistent() { return usable; },
      getItem: function ( key ) {
        if ( Object.prototype.hasOwnProperty.call( mem, key ) ) return mem[ key ];
        if ( ! usable ) return null;
        try { return ls.getItem( key ); } catch ( e ) { return null; }
      },
      setItem: function ( key, value ) {
        value = String( value );
        mem[ key ] = value;                       // write-through cache keeps the session consistent
        if ( ! usable ) return false;
        try { ls.setItem( key, value ); return true; }
        catch ( e ) { usable = false; warn(); return false; }   // quota exceeded / revoked
      },
      removeItem: function ( key ) {
        mem[ key ] = null;
        if ( ! usable ) return;
        try { ls.removeItem( key ); } catch ( e ) {}
      },
    };

  } )();

  /* ------------------------------------------------------------------ */
  /* CrazyGames SDK wrapper. Every call is optional and guarded, so the  */
  /* game runs the same standalone, offline, or with an ad blocker.      */
  /* Docs: https://docs.crazygames.com/sdk/intro/                        */
  /* ------------------------------------------------------------------ */
  var Platform = window.Platform = {

    sdk: null,
    adActive: false,
    _gameplay: false,

    init: function () {

      return loadScript( CONFIG.crazyGamesSdk, CONFIG.sdkTimeoutMs )
        .then( function () {
          var sdk = window.CrazyGames && window.CrazyGames.SDK;
          if ( ! sdk || typeof sdk.init !== 'function' ) throw new Error( 'SDK object missing' );
          return Promise.race( [
            sdk.init(),
            new Promise( function ( _, reject ) { setTimeout( function () { reject( new Error( 'SDK init timed out' ) ); }, CONFIG.sdkTimeoutMs ); } ),
          ] ).then( function () { Platform.sdk = sdk; } );
        } )
        .catch( function ( e ) {
          Platform.sdk = null;
          if ( window.console ) console.info( '[Platform] CrazyGames SDK not active, running standalone:', e && e.message );
        } );

    },

    _call: function ( fn ) { try { if ( this.sdk ) fn( this.sdk ); } catch ( e ) { if ( window.console ) console.warn( '[Platform]', e ); } },

    loadingStart: function () { this._call( function ( s ) { s.game.loadingStart(); } ); },
    loadingStop: function () { this._call( function ( s ) { s.game.loadingStop(); } ); },

    // Call whenever the player starts or stops actively playing (menus, pause, solve screen = stopped).
    gameplay: function ( active ) {
      active = !! active;
      if ( active === this._gameplay ) return;
      this._gameplay = active;
      this._call( function ( s ) { active ? s.game.gameplayStart() : s.game.gameplayStop(); } );
    },

    // Use sparingly (docs): we only call it for a new personal best.
    happytime: function () { this._call( function ( s ) { s.game.happytime(); } ); },

    // Midgame ad at a natural break. Calls cb.finished exactly once, also when there is no SDK,
    // the ad is unfilled, or an ad blocker is present.
    requestMidgame: function ( cb ) {

      cb = cb || {};
      var done = false;

      function finish() {
        if ( done ) return;
        done = true;
        Platform.adActive = false;
        if ( cb.finished ) cb.finished();
      }

      if ( ! CONFIG.ads.enabled || ! this.sdk || ! this.sdk.ad ) { finish(); return false; }

      try {
        this.sdk.ad.requestAd( 'midgame', {
          adStarted: function () { Platform.adActive = true; if ( cb.started ) cb.started(); },
          adFinished: finish,
          adError: finish,
        } );
      } catch ( e ) { finish(); }

      return true;

    },

  };

  /* ------------------------------------------------------------------ */
  /* Loader + error screen                                               */
  /* ------------------------------------------------------------------ */
  function progress( pct, msg ) {
    var fill = $( 'boot-fill' ), text = $( 'boot-msg' );
    if ( fill ) fill.style.width = Math.max( 0, Math.min( 100, pct ) ) + '%';
    if ( text && msg ) text.textContent = msg;
  }

  function fail( title, text, hints, detail ) {

    if ( ready ) return;

    var boot = $( 'boot' );
    if ( boot ) boot.classList.add( 'boot--failed' );

    if ( $( 'boot-error-title' ) ) $( 'boot-error-title' ).textContent = title;
    if ( $( 'boot-error-text' ) ) $( 'boot-error-text' ).textContent = text;

    var list = $( 'boot-error-hints' );
    if ( list ) {
      list.innerHTML = '';
      ( hints || [] ).forEach( function ( h ) {
        var li = document.createElement( 'li' );
        li.textContent = h;
        list.appendChild( li );
      } );
    }

    if ( $( 'boot-error-detail' ) ) {
      $( 'boot-error-detail' ).textContent = [ detail, lastError && ( 'Last script error: ' + lastError ),
        'Version ' + CONFIG.version + ' | ' + navigator.userAgent ].filter( Boolean ).join( '\n' );
    }

    if ( $( 'boot-error' ) ) $( 'boot-error' ).hidden = false;
    if ( $( 'boot-msg' ) ) $( 'boot-msg' ).hidden = true;

    Platform.loadingStop();

  }

  function finishBoot() {

    ready = true;
    progress( 100, 'Ready' );
    document.documentElement.classList.add( 'pro-ready' );

    var boot = $( 'boot' );
    if ( boot ) {
      boot.classList.add( 'boot--done' );
      setTimeout( function () { if ( boot.parentNode ) boot.parentNode.removeChild( boot ); }, 600 );
    }

    Platform.loadingStop();

  }

  window.Boot = { progress: progress, fail: fail, isReady: function () { return ready; } };

  /* Global error capture: fatal while booting, quiet afterwards (the game keeps running). */
  window.addEventListener( 'error', function ( e ) {
    var msg = ( e && e.message ) || 'Unknown error';
    if ( msg === 'Script error.' ) return;     // cross-origin noise, no details available
    lastError = msg + ( e.filename ? ' (' + String( e.filename ).split( '/' ).pop() + ':' + e.lineno + ')' : '' );
    if ( window.console ) console.error( '[The Cube]', lastError );
    if ( ready && window.Pro && window.Pro.reportError ) window.Pro.reportError();
  } );

  /* ------------------------------------------------------------------ */
  /* Script loading                                                      */
  /* ------------------------------------------------------------------ */
  function loadScript( src, timeout ) {
    return new Promise( function ( resolve, reject ) {
      var s = document.createElement( 'script' ), timer = null;
      s.src = src;
      s.onload = function () { clearTimeout( timer ); resolve(); };
      s.onerror = function () { clearTimeout( timer ); if ( s.parentNode ) s.parentNode.removeChild( s ); reject( new Error( 'Could not load ' + src ) ); };
      if ( timeout ) timer = setTimeout( function () { reject( new Error( 'Timed out loading ' + src ) ); }, timeout );
      document.head.appendChild( s );
    } );
  }

  function loadThree() {
    if ( window.THREE ) return Promise.resolve();
    return loadScript( CONFIG.threeLocal, 8000 )
      .catch( function () { progress( 25, 'Loading 3D engine (online)...' ); return loadScript( CONFIG.threeCdn, CONFIG.scriptTimeoutMs ); } )
      .then( function () {
        if ( ! window.THREE ) throw new Error( 'THREE is undefined after load' );
        if ( window.console && String( THREE.REVISION ) !== '95' ) console.warn( '[The Cube] Built for Three.js r95, found r' + THREE.REVISION );
      } );
  }

  function webglAvailable() {
    try {
      var canvas = document.createElement( 'canvas' );
      var gl = canvas.getContext( 'webgl' ) || canvas.getContext( 'experimental-webgl' );
      if ( ! gl ) return false;
      var lose = gl.getExtension( 'WEBGL_lose_context' );
      if ( lose ) lose.loseContext();
      return true;
    } catch ( e ) { return false; }
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */
  function start() {

    var reload = $( 'boot-reload' );
    if ( reload ) reload.addEventListener( 'click', function () { window.location.reload(); } );

    var slow = setTimeout( function () { if ( ! ready ) progress( 60, 'Still loading - slow connection?' ); }, 10000 );

    progress( 4, 'Checking your device...' );

    if ( ! webglAvailable() ) {
      clearTimeout( slow );
      return fail( 'Your browser can\'t show 3D graphics',
        'This game needs WebGL, which is turned off or unsupported here.',
        [ 'Turn on hardware acceleration in your browser settings, then reload.',
          'Update your browser and graphics drivers.',
          'Try a different browser such as Chrome, Edge, Firefox or Safari.' ],
        'WebGL context creation failed' );
    }

    var sdkReady = Platform.init();
    sdkReady.then( function () { Platform.loadingStart(); } );

    progress( 10, 'Loading 3D engine...' );

    loadThree()
      .catch( function ( e ) {
        throw { stage: 'three', error: e };
      } )
      .then( function () {
        progress( 55, 'Loading game...' );
        return loadScript( 'main.js', CONFIG.scriptTimeoutMs ).catch( function ( e ) { throw { stage: 'main', error: e }; } );
      } )
      .then( function () { return sdkReady; } )
      .then( function () {
        progress( 75, 'Building the cube...' );
        if ( ! window.TheCube ) throw { stage: 'init', error: new Error( 'main.js did not finish (see console)' ) };
        try { window.TheCube.create(); } catch ( e ) { throw { stage: 'init', error: e }; }
        progress( 90, 'Almost there...' );
        return loadScript( 'pro.js', CONFIG.scriptTimeoutMs ).catch( function ( e ) { throw { stage: 'pro', error: e }; } );
      } )
      .then( function () {
        clearTimeout( slow );
        // let the first frame render before revealing
        requestAnimationFrame( function () { requestAnimationFrame( finishBoot ); } );
      } )
      .catch( function ( f ) {
        clearTimeout( slow );
        var stage = f && f.stage, err = ( f && f.error ) || f;
        var detail = ( stage ? stage + ': ' : '' ) + ( err && ( err.stack || err.message ) || String( err ) );
        if ( stage === 'three' ) {
          fail( 'Couldn\'t load the 3D engine',
            'The game files could not be downloaded.',
            [ 'Check your internet connection and reload.', 'Turn off any content blocker that may block cdnjs.cloudflare.com.' ], detail );
        } else if ( stage === 'init' && /webgl/i.test( detail ) ) {
          fail( 'Your browser can\'t show 3D graphics',
            'The graphics context could not be created.',
            [ 'Turn on hardware acceleration and reload.', 'Close other tabs or apps that use the GPU.' ], detail );
        } else {
          fail( 'The game could not start', 'Something went wrong while starting.',
            [ 'Reload the page.', 'If it keeps happening, try another browser.' ], detail );
        }
      } );

  }

  if ( document.readyState === 'loading' ) document.addEventListener( 'DOMContentLoaded', start );
  else start();

} )();
