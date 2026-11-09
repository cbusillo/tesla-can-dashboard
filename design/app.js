/* ==========================================================================
   Tesla CAN Telemetry & Instrument Deck — Application Logic
   Replay-only static experiment; reads ./fixture.json with zero external deps
   ========================================================================== */

(function () {
  'use strict';

  var FALLBACK_FIXTURE = {
    schemaVersion: 1,
    source: 'sanitized parked battery capture; no identity or location fields',
    mode: 'replay',
    state: 'connected',
    values: {
      displayedChargePercent: 67.2,
      voltageV: 377.63,
      currentA: -0.6000000000000001,
      fullPackEnergyKwh: 80.5,
      minimumTemperatureC: 18.0,
      maximumTemperatureC: 21.300000000000004
    },
    cellGroups: [
      { index: 1, voltageV: 3.9309, minimumV: 3.9307, maximumV: 3.931, state: 'valid' },
      { index: 2, voltageV: 3.9312, minimumV: 3.931, maximumV: 3.9312, state: 'valid' },
      { index: 3, voltageV: 3.9319, minimumV: 3.9319, maximumV: 3.9321, state: 'valid' },
      { index: 4, voltageV: 3.9318, minimumV: 3.9318, maximumV: 3.9319, state: 'valid' },
      { index: 5, voltageV: 3.9313, minimumV: 3.9312, maximumV: 3.9315, state: 'valid' },
      { index: 6, voltageV: 3.9312, minimumV: 3.931, maximumV: 3.9313, state: 'valid' },
      { index: 7, voltageV: 3.9315, minimumV: 3.9315, maximumV: 3.9316, state: 'valid' },
      { index: 8, voltageV: 3.9318, minimumV: 3.9318, maximumV: 3.9319, state: 'valid' },
      { index: 9, voltageV: 3.9324, minimumV: 3.9324, maximumV: 3.9325, state: 'valid' },
      { index: 10, voltageV: 3.9318, minimumV: 3.9316, maximumV: 3.9319, state: 'valid' },
      { index: 11, voltageV: 3.9319, minimumV: 3.9318, maximumV: 3.9321, state: 'valid' },
      { index: 12, voltageV: 3.9328, minimumV: 3.9327, maximumV: 3.933, state: 'valid' },
      { index: 13, voltageV: 3.9334, minimumV: 3.9333, maximumV: 3.9334, state: 'valid' },
      { index: 14, voltageV: 3.9334, minimumV: 3.9333, maximumV: 3.9334, state: 'valid' },
      { index: 15, voltageV: 3.9333, minimumV: 3.9331, maximumV: 3.9334, state: 'valid' },
      { index: 16, voltageV: 3.9325, minimumV: 3.9324, maximumV: 3.9327, state: 'valid' },
      { index: 17, voltageV: 3.9327, minimumV: 3.9325, maximumV: 3.9328, state: 'valid' },
      { index: 18, voltageV: 3.933, minimumV: 3.9328, maximumV: 3.933, state: 'valid' },
      { index: 19, voltageV: 3.9334, minimumV: 3.9333, maximumV: 3.9334, state: 'valid' },
      { index: 20, voltageV: 3.933, minimumV: 3.933, maximumV: 3.9331, state: 'valid' },
      { index: 21, voltageV: 3.9328, minimumV: 3.9327, maximumV: 3.9328, state: 'valid' },
      { index: 22, voltageV: 3.9336, minimumV: 3.9334, maximumV: 3.9336, state: 'valid' },
      { index: 23, voltageV: 3.9327, minimumV: 3.9325, maximumV: 3.9327, state: 'valid' },
      { index: 24, voltageV: 3.9345, minimumV: 3.9343, maximumV: 3.9346, state: 'valid' },
      { index: 25, voltageV: 3.9345, minimumV: 3.9343, maximumV: 3.9346, state: 'valid' },
      { index: 26, voltageV: 3.9345, minimumV: 3.9343, maximumV: 3.9345, state: 'valid' },
      { index: 27, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9345, state: 'valid' },
      { index: 28, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9343, state: 'valid' },
      { index: 29, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9343, state: 'valid' },
      { index: 30, voltageV: 3.9345, minimumV: 3.9343, maximumV: 3.9345, state: 'valid' },
      { index: 31, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9345, state: 'valid' },
      { index: 32, voltageV: 3.9342, minimumV: 3.9342, maximumV: 3.9343, state: 'valid' },
      { index: 33, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9345, state: 'valid' },
      { index: 34, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9345, state: 'valid' },
      { index: 35, voltageV: 3.934, minimumV: 3.934, maximumV: 3.9342, state: 'valid' },
      { index: 36, voltageV: 3.9339, minimumV: 3.9337, maximumV: 3.9339, state: 'valid' },
      { index: 37, voltageV: 3.934, minimumV: 3.9339, maximumV: 3.9342, state: 'valid' },
      { index: 38, voltageV: 3.934, minimumV: 3.9339, maximumV: 3.9342, state: 'valid' },
      { index: 39, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9342, state: 'valid' },
      { index: 40, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9343, state: 'valid' },
      { index: 41, voltageV: 3.9342, minimumV: 3.9342, maximumV: 3.9343, state: 'valid' },
      { index: 42, voltageV: 3.934, minimumV: 3.934, maximumV: 3.9342, state: 'valid' },
      { index: 43, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9343, state: 'valid' },
      { index: 44, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9343, state: 'valid' },
      { index: 45, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9343, state: 'valid' },
      { index: 46, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9342, state: 'valid' },
      { index: 47, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9343, state: 'valid' },
      { index: 48, voltageV: 3.9337, minimumV: 3.9337, maximumV: 3.9339, state: 'valid' },
      { index: 49, voltageV: 3.9342, minimumV: 3.9342, maximumV: 3.9343, state: 'valid' },
      { index: 50, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9343, state: 'valid' },
      { index: 51, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9342, state: 'valid' },
      { index: 52, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9343, state: 'valid' },
      { index: 53, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9343, state: 'valid' },
      { index: 54, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9343, state: 'valid' },
      { index: 55, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9345, state: 'valid' },
      { index: 56, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9345, state: 'valid' },
      { index: 57, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9345, state: 'valid' },
      { index: 58, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9343, state: 'valid' },
      { index: 59, voltageV: 3.9342, minimumV: 3.9342, maximumV: 3.9343, state: 'valid' },
      { index: 60, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9343, state: 'valid' },
      { index: 61, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9342, state: 'valid' },
      { index: 62, voltageV: 3.9342, minimumV: 3.9342, maximumV: 3.9343, state: 'valid' },
      { index: 63, voltageV: 3.9342, minimumV: 3.934, maximumV: 3.9342, state: 'valid' },
      { index: 64, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9345, state: 'valid' },
      { index: 65, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9343, state: 'valid' },
      { index: 66, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9343, state: 'valid' },
      { index: 67, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9345, state: 'valid' },
      { index: 68, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9343, state: 'valid' },
      { index: 69, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9345, state: 'valid' },
      { index: 70, voltageV: 3.9343, minimumV: 3.9343, maximumV: 3.9345, state: 'valid' },
      { index: 71, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9345, state: 'valid' },
      { index: 72, voltageV: 3.9343, minimumV: 3.9343, maximumV: 3.9345, state: 'valid' },
      { index: 73, voltageV: 3.9343, minimumV: 3.9342, maximumV: 3.9345, state: 'valid' },
      { index: 74, voltageV: 3.9321, minimumV: 3.9321, maximumV: 3.9322, state: 'valid' },
      { index: 75, voltageV: 3.9325, minimumV: 3.9324, maximumV: 3.9327, state: 'valid' },
      { index: 76, voltageV: 3.9324, minimumV: 3.9322, maximumV: 3.9325, state: 'valid' },
      { index: 77, voltageV: 3.9324, minimumV: 3.9322, maximumV: 3.9324, state: 'valid' },
      { index: 78, voltageV: 3.9324, minimumV: 3.9322, maximumV: 3.9325, state: 'valid' },
      { index: 79, voltageV: 3.9324, minimumV: 3.9322, maximumV: 3.9324, state: 'valid' },
      { index: 80, voltageV: 3.9319, minimumV: 3.9318, maximumV: 3.9319, state: 'valid' },
      { index: 81, voltageV: 3.9322, minimumV: 3.9321, maximumV: 3.9322, state: 'valid' },
      { index: 82, voltageV: 3.9324, minimumV: 3.9324, maximumV: 3.9325, state: 'valid' },
      { index: 83, voltageV: 3.9325, minimumV: 3.9325, maximumV: 3.9327, state: 'valid' },
      { index: 84, voltageV: 3.9325, minimumV: 3.9324, maximumV: 3.9325, state: 'valid' },
      { index: 85, voltageV: 3.9327, minimumV: 3.9325, maximumV: 3.9328, state: 'valid' },
      { index: 86, voltageV: 3.9328, minimumV: 3.9328, maximumV: 3.933, state: 'valid' },
      { index: 87, voltageV: 3.9324, minimumV: 3.9324, maximumV: 3.9325, state: 'valid' },
      { index: 88, voltageV: 3.9327, minimumV: 3.9327, maximumV: 3.9328, state: 'valid' },
      { index: 89, voltageV: 3.933, minimumV: 3.933, maximumV: 3.9331, state: 'valid' },
      { index: 90, voltageV: 3.9325, minimumV: 3.9324, maximumV: 3.9327, state: 'valid' },
      { index: 91, voltageV: 3.9327, minimumV: 3.9327, maximumV: 3.9328, state: 'valid' },
      { index: 92, voltageV: 3.9327, minimumV: 3.9327, maximumV: 3.9328, state: 'valid' },
      { index: 93, voltageV: 3.933, minimumV: 3.9328, maximumV: 3.9331, state: 'valid' },
      { index: 94, voltageV: 3.9324, minimumV: 3.9322, maximumV: 3.9325, state: 'valid' },
      { index: 95, voltageV: 3.9327, minimumV: 3.9325, maximumV: 3.9328, state: 'valid' },
      { index: 96, voltageV: 3.9327, minimumV: 3.9325, maximumV: 3.9328, state: 'valid' }
    ],
    scenarios: [
      { atSeconds: 0, state: 'connected' },
      { atSeconds: 10, signal: 'fullPackEnergyKwh', state: 'unavailable' },
      { atSeconds: 15, state: 'stale' },
      { atSeconds: 20, state: 'disconnected' },
      { atSeconds: 25, state: 'connected' }
    ],
    performanceDemo: {
      mode: 'simulated',
      rollout: 'none',
      zeroTo60MphSeconds: 4.9,
      quarterMileSeconds: 13.2,
      peakBatteryPowerKw: 280,
      note: 'Fictional UI examples, not measured vehicle results'
    },
    controlDemo: {
      mode: 'simulated',
      actions: ['glovebox', 'fold mirrors', 'charge port'],
      outcomes: ['pending', 'confirmed', 'unconfirmed'],
      realCommandsAllowed: false
    }
  };

  var state = {
    fixture: FALLBACK_FIXTURE,
    activeView: 'overview',
    theme: 'night',
    scenarioIdx: 0,
    isPlaying: false,
    playTimer: null,
    gaugeSlots: ['voltageV', 'displayedChargePercent', 'fullPackEnergyKwh'],
    activePreset: 'electrical',
    selectedCellIndex: 1,
    cellsViewMode: 'matrix', // 'matrix' | 'profile'
    perfRolloutCompare: false,
    cellStats: null,
    controlStates: {}
  };

  /* ------------------------------------------------------------------------
     Cell Statistics Computation
     ------------------------------------------------------------------------ */
  function computeCellStats(groups) {
    var minGroup = groups[0];
    var maxGroup = groups[0];
    var envMinV = groups[0].minimumV;
    var envMaxV = groups[0].maximumV;
    var sumV = 0;

    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      sumV += g.voltageV;
      if (g.voltageV < minGroup.voltageV) minGroup = g;
      if (g.voltageV > maxGroup.voltageV) maxGroup = g;
      if (g.minimumV < envMinV) envMinV = g.minimumV;
      if (g.maximumV > envMaxV) envMaxV = g.maximumV;
    }

    var meanV = sumV / groups.length;
    var nominalSpreadMv = (maxGroup.voltageV - minGroup.voltageV) * 1000;
    var envelopeSpreadMv = (envMaxV - envMinV) * 1000;

    return {
      minGroup: minGroup,
      maxGroup: maxGroup,
      envMinV: envMinV,
      envMaxV: envMaxV,
      meanV: meanV,
      nominalSpreadMv: nominalSpreadMv,
      envelopeSpreadMv: envelopeSpreadMv
    };
  }

  /* ------------------------------------------------------------------------
     Scenario & Signal State Resolution
     Never render absent/unavailable/disconnected signals as zero!
     ------------------------------------------------------------------------ */
  function getCurrentScenario() {
    var list = state.fixture.scenarios || FALLBACK_FIXTURE.scenarios;
    var idx = Math.max(0, Math.min(state.scenarioIdx, list.length - 1));
    var raw = list[idx];
    var isRecovered = idx === 4 && raw.state === 'connected';
    var qualityKey = isRecovered
      ? 'recovered'
      : raw.signal === 'fullPackEnergyKwh' && raw.state === 'unavailable'
      ? 'unavailable'
      : raw.state;

    return {
      index: idx,
      atSeconds: raw.atSeconds,
      streamState: raw.state,
      unavailableSignal: raw.signal || null,
      isRecovered: isRecovered,
      qualityKey: qualityKey
    };
  }

  function getSignalCatalog() {
    var vals = state.fixture.values;
    var cs = state.cellStats;
    var sc = getCurrentScenario();

    function resolveState(signalKey) {
      if (sc.streamState === 'disconnected') return 'disconnected';
      if (sc.unavailableSignal === signalKey) return 'unavailable';
      if (sc.streamState === 'stale') return 'stale';
      return 'valid';
    }

    var tempSpread = vals.maximumTemperatureC - vals.minimumTemperatureC;

    return {
      voltageV: {
        label: 'Pack voltage',
        unit: 'V',
        min: 300,
        max: 405,
        raw: vals.voltageV,
        formatted: vals.voltageV.toFixed(2),
        rangeText: '300–405 V',
        subnote: 'Nominal 96s pack voltage',
        state: resolveState('voltageV')
      },
      displayedChargePercent: {
        label: 'Displayed charge',
        unit: '%',
        min: 0,
        max: 100,
        raw: vals.displayedChargePercent,
        formatted: vals.displayedChargePercent.toFixed(1),
        rangeText: '0–100 %',
        subnote: 'Usable displayed SOC',
        state: resolveState('displayedChargePercent')
      },
      currentA: {
        label: 'Raw bus current',
        unit: 'A',
        min: -50,
        max: 50,
        raw: vals.currentA,
        formatted: vals.currentA.toFixed(2),
        rangeText: 'Raw sign (unqualified)',
        subnote: 'Sign direction unqualified',
        state: resolveState('currentA')
      },
      fullPackEnergyKwh: {
        label: 'Full pack energy',
        unit: 'kWh',
        min: 0,
        max: 100,
        raw: vals.fullPackEnergyKwh,
        formatted: vals.fullPackEnergyKwh.toFixed(1),
        rangeText: '0–100 kWh',
        subnote: 'Nominal full capacity',
        state: resolveState('fullPackEnergyKwh')
      },
      cellSpreadMv: {
        label: 'Cell group spread',
        unit: 'mV',
        min: 0,
        max: 20,
        raw: cs.nominalSpreadMv,
        formatted: cs.nominalSpreadMv.toFixed(1),
        rangeText: '0–20 mV scale',
        subnote: '96-group max minus min',
        state: resolveState('cellSpreadMv')
      },
      tempWindowC: {
        label: 'Temp window',
        unit: '°C',
        min: 0,
        max: 50,
        raw: vals.maximumTemperatureC,
        formatted: vals.minimumTemperatureC.toFixed(1) + '–' + vals.maximumTemperatureC.toFixed(1),
        rangeText: 'Δ ' + tempSpread.toFixed(1) + ' °C span',
        subnote: 'Min 18.0°C to Max 21.3°C',
        state: resolveState('tempWindowC')
      }
    };
  }

  /* ------------------------------------------------------------------------
     SVG Radial Arc Instrument Renderer (tesLAX-style precision dial)
     ------------------------------------------------------------------------ */
  function polarToCartesian(cx, cy, r, angleDeg) {
    var rad = ((angleDeg - 90) * Math.PI) / 180.0;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad)
    };
  }

  function describeArc(cx, cy, r, startAngle, endAngle) {
    var start = polarToCartesian(cx, cy, r, endAngle);
    var end = polarToCartesian(cx, cy, r, startAngle);
    var largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return ['M', start.x.toFixed(2), start.y.toFixed(2), 'A', r, r, 0, largeArcFlag, 0, end.x.toFixed(2), end.y.toFixed(2)].join(' ');
  }

  function renderRadialGaugeSVG(signalMeta) {
    var cx = 65;
    var cy = 62;
    var r = 46;
    var startAngle = -120;
    var endAngle = 120;
    var sweep = endAngle - startAngle; // 240 deg

    var st = signalMeta.state;
    var isAvailable = st === 'valid' || st === 'stale';
    var norm = 0;
    if (isAvailable) {
      norm = (signalMeta.raw - signalMeta.min) / (signalMeta.max - signalMeta.min);
      norm = Math.max(0, Math.min(1, norm));
    }

    var valAngle = startAngle + norm * sweep;
    var trackPath = describeArc(cx, cy, r, startAngle, endAngle);
    var activePath = isAvailable && norm > 0.005 ? describeArc(cx, cy, r, startAngle, valAngle) : '';

    var strokeColor = 'var(--accent-primary)';
    if (st === 'stale' || st === 'unavailable') strokeColor = 'var(--accent-amber)';
    if (st === 'disconnected') strokeColor = 'var(--accent-fault)';

    // Generate tick marks
    var ticksHtml = '';
    var numTicks = 16;
    for (var i = 0; i <= numTicks; i++) {
      var a = startAngle + (i / numTicks) * sweep;
      var isMajor = i % 4 === 0;
      var pOut = polarToCartesian(cx, cy, r + 5, a);
      var pIn = polarToCartesian(cx, cy, r + (isMajor ? 0 : 2.2), a);
      ticksHtml +=
        '<line x1="' +
        pIn.x.toFixed(1) +
        '" y1="' +
        pIn.y.toFixed(1) +
        '" x2="' +
        pOut.x.toFixed(1) +
        '" y2="' +
        pOut.y.toFixed(1) +
        '" stroke="' +
        (isMajor ? 'var(--gauge-tick-major)' : 'var(--gauge-tick)') +
        '" stroke-width="' +
        (isMajor ? '1.5' : '1') +
        '" />';
    }

    // Needle tip & base
    var needleHtml = '';
    if (isAvailable) {
      var tip = polarToCartesian(cx, cy, r - 6, valAngle);
      needleHtml =
        '<line x1="' +
        cx +
        '" y1="' +
        cy +
        '" x2="' +
        tip.x.toFixed(1) +
        '" y2="' +
        tip.y.toFixed(1) +
        '" stroke="' +
        strokeColor +
        '" stroke-width="2" stroke-linecap="round" />' +
        '<circle cx="' +
        cx +
        '" cy="' +
        cy +
        '" r="3.5" fill="' +
        strokeColor +
        '" />';
    } else {
      needleHtml =
        '<circle cx="' +
        cx +
        '" cy="' +
        cy +
        '" r="3.5" fill="none" stroke="' +
        strokeColor +
        '" stroke-width="1.5" stroke-dasharray="2 2" />';
    }

    var centerValue = signalMeta.formatted;
    var centerSub = signalMeta.unit;
    if (st === 'unavailable') {
      centerValue = 'Unavail';
      centerSub = 'No frame (' + signalMeta.unit + ')';
    } else if (st === 'disconnected') {
      centerValue = 'Offline';
      centerSub = 'Bus lost (' + signalMeta.unit + ')';
    } else if (st === 'stale') {
      centerSub = signalMeta.unit + ' · Stale';
    }

    var fontSize = centerValue.length > 7 ? '13' : centerValue.length > 5 ? '15.5' : '18';

    return (
      '<svg class="radial-svg" viewBox="0 0 130 110" role="img" aria-label="' +
      signalMeta.label +
      ' gauge: ' +
      centerValue +
      ' ' +
      centerSub +
      '">' +
      ticksHtml +
      '<path d="' +
      trackPath +
      '" fill="none" stroke="var(--gauge-track)" stroke-width="6.5" stroke-linecap="round" ' +
      (!isAvailable ? 'stroke-dasharray="4 3"' : '') +
      ' />' +
      (activePath
        ? '<path d="' +
          activePath +
          '" fill="none" stroke="' +
          strokeColor +
          '" stroke-width="6.5" stroke-linecap="round" ' +
          (st === 'stale' ? 'stroke-dasharray="5 2"' : '') +
          ' />'
        : '') +
      needleHtml +
      '<text x="' +
      cx +
      '" y="84" text-anchor="middle" fill="var(--text-primary)" font-family="var(--font-telemetry)" font-size="' +
      fontSize +
      '" font-weight="700">' +
      centerValue +
      '</text>' +
      '<text x="' +
      cx +
      '" y="99" text-anchor="middle" fill="var(--text-secondary)" font-family="var(--font-telemetry)" font-size="10" font-weight="600">' +
      centerSub +
      '</text>' +
      '</svg>'
    );
  }

  /* ------------------------------------------------------------------------
     Render Top Spine & Overview
     ------------------------------------------------------------------------ */
  function renderTopSpine() {
    var sc = getCurrentScenario();
    var pill = document.getElementById('quality-pill');
    var label = document.getElementById('quality-label');
    var timeReadout = document.getElementById('replay-time-readout');
    var playBtn = document.getElementById('replay-play-btn');
    var playIcon = document.getElementById('replay-play-icon');

    pill.setAttribute('data-quality', sc.qualityKey);
    timeReadout.textContent = (sc.atSeconds < 10 ? '0' : '') + sc.atSeconds + 's';
    playBtn.setAttribute('aria-pressed', state.isPlaying ? 'true' : 'false');
    playIcon.textContent = state.isPlaying ? '⏸' : '▶';

    if (sc.qualityKey === 'connected') {
      label.textContent = 'Replay · Connected';
    } else if (sc.qualityKey === 'unavailable') {
      label.textContent = 'Replay · Unavail (10s)';
    } else if (sc.qualityKey === 'stale') {
      label.textContent = 'Replay · Stale (15s)';
    } else if (sc.qualityKey === 'disconnected') {
      label.textContent = 'Replay · Offline (20s)';
    } else if (sc.qualityKey === 'recovered') {
      label.textContent = 'Replay · Recovered (25s)';
    }

    var btns = document.querySelectorAll('.scenario-btn');
    for (var i = 0; i < btns.length; i++) {
      var idx = parseInt(btns[i].getAttribute('data-scenario-idx'), 10);
      btns[i].setAttribute('aria-pressed', idx === sc.index ? 'true' : 'false');
    }
  }

  function renderOverview() {
    var sc = getCurrentScenario();
    var catalog = getSignalCatalog();
    var vals = state.fixture.values;
    var cs = state.cellStats;

    // 1. Render Configurable Radial Gauge Slots 1 & 2
    for (var slot = 1; slot <= 2; slot++) {
      var sigKey = state.gaugeSlots[slot - 1];
      var meta = catalog[sigKey];
      var well = document.getElementById('gauge-well-' + slot);
      var selectEl = document.getElementById('gauge-select-' + slot);
      var svgWrap = document.getElementById('gauge-svg-wrap-' + slot);
      var rangeEl = document.getElementById('gauge-range-' + slot);
      var stateEl = document.getElementById('gauge-state-' + slot);

      if (selectEl.value !== sigKey) selectEl.value = sigKey;
      well.setAttribute('data-signal-state', meta.state);
      svgWrap.innerHTML = renderRadialGaugeSVG(meta);
      rangeEl.textContent = meta.rangeText;
      stateEl.textContent =
        meta.state === 'valid'
          ? sc.isRecovered
            ? 'Recovered'
            : 'Valid'
          : meta.state.charAt(0).toUpperCase() + meta.state.slice(1);
    }

    // 2. Render Slot 3 Linear Strip Instrument
    var sigKey3 = state.gaugeSlots[2];
    var meta3 = catalog[sigKey3];
    var stripWell = document.getElementById('strip-gauge-well');
    var select3 = document.getElementById('gauge-select-3');
    var readout3 = document.getElementById('strip-readout-3');
    var fill3 = document.getElementById('strip-bar-fill-3');
    var min3 = document.getElementById('strip-min-3');
    var max3 = document.getElementById('strip-max-3');
    var note3 = document.getElementById('strip-note-3');

    if (select3.value !== sigKey3) select3.value = sigKey3;
    stripWell.setAttribute('data-signal-state', meta3.state);
    min3.textContent = meta3.min + ' ' + meta3.unit;
    max3.textContent = meta3.max + ' ' + meta3.unit;

    if (meta3.state === 'unavailable') {
      readout3.textContent = 'Unavailable · — ' + meta3.unit;
      fill3.style.width = '0%';
      note3.textContent = 'Signal absent at t=10s — not 0';
    } else if (meta3.state === 'disconnected') {
      readout3.textContent = 'Offline · — ' + meta3.unit;
      fill3.style.width = '0%';
      note3.textContent = 'CAN stream disconnected at t=20s';
    } else {
      readout3.textContent =
        meta3.formatted + ' ' + meta3.unit + (meta3.state === 'stale' ? ' · Stale' : '');
      var pct3 = ((meta3.raw - meta3.min) / (meta3.max - meta3.min)) * 100;
      pct3 = Math.max(2, Math.min(100, pct3));
      fill3.style.width = pct3.toFixed(1) + '%';
      fill3.style.background =
        meta3.state === 'stale' ? 'var(--accent-amber)' : 'var(--accent-primary)';
      note3.textContent =
        meta3.state === 'stale' ? 'Last frame aged >5s (frozen)' : meta3.subnote;
    }

    // 3. State Banner in Telemetry Bay
    var banner = document.getElementById('overview-state-banner');
    var bannerText = document.getElementById('overview-state-text');
    var bannerBtn = document.getElementById('overview-state-action-btn');
    banner.setAttribute('data-state', sc.qualityKey);

    if (sc.qualityKey === 'connected') {
      bannerText.textContent =
        'Connected at t=0s — all 96 cell groups, pack voltage, current, temperatures and energy valid.';
      bannerBtn.textContent = 'Test 10s Energy Unavail →';
      bannerBtn.onclick = function () {
        setScenario(1);
      };
    } else if (sc.qualityKey === 'unavailable') {
      bannerText.textContent =
        't=10s: fullPackEnergyKwh is unavailable on bus. Shown as Unavailable (never 0 kWh); other signals remain valid.';
      bannerBtn.textContent = 'Test 15s Stale →';
      bannerBtn.onclick = function () {
        setScenario(2);
      };
    } else if (sc.qualityKey === 'stale') {
      bannerText.textContent =
        't=15s: Stream frames are stale. Last-known readings are retained with Stale badges so they are not mistaken for fresh data.';
      bannerBtn.textContent = 'Test 20s Disconnect →';
      bannerBtn.onclick = function () {
        setScenario(3);
      };
    } else if (sc.qualityKey === 'disconnected') {
      bannerText.textContent =
        't=20s: CAN replay bus disconnected. Live telemetry channels show Offline (—), never zero.';
      bannerBtn.textContent = 'Recover Stream (25s) →';
      bannerBtn.onclick = function () {
        setScenario(4);
      };
    } else if (sc.qualityKey === 'recovered') {
      bannerText.textContent =
        't=25s: Stream recovered after disconnect — fullPackEnergyKwh (80.5 kWh) and all pack frames restored.';
      bannerBtn.textContent = 'Restart at 0s ↺';
      bannerBtn.onclick = function () {
        setScenario(0);
      };
    }

    // 4. Primary 3-Channel Readouts (Voltage, Current, Displayed Charge)
    var isDisc = sc.streamState === 'disconnected';
    var isStale = sc.streamState === 'stale';
    var channelState = isDisc ? 'disconnected' : isStale ? 'stale' : 'valid';
    var tagState = isDisc ? 'offline' : isStale ? 'stale' : 'valid';

    // Voltage
    document.getElementById('ch-voltage').setAttribute('data-state', channelState);
    var tagV = document.getElementById('tag-voltage');
    tagV.setAttribute('data-tag', tagState);
    tagV.textContent = isDisc ? 'Offline' : isStale ? 'Stale · 15s' : sc.isRecovered ? 'Recovered' : 'Valid';
    document.getElementById('val-voltage').textContent = isDisc ? '—' : vals.voltageV.toFixed(2);
    document.getElementById('unit-voltage').textContent = isDisc ? 'V (Offline)' : 'V';
    document.getElementById('note-voltage').textContent = isDisc
      ? 'Bus disconnected; last 377.63 V withheld'
      : '96s mean ' + cs.meanV.toFixed(4) + ' V · Δ ' + cs.nominalSpreadMv.toFixed(1) + ' mV';

    // Current (Always keep direction unqualified!)
    document.getElementById('ch-current').setAttribute('data-state', channelState);
    var tagA = document.getElementById('tag-current');
    tagA.setAttribute('data-tag', tagState);
    tagA.textContent = isDisc ? 'Offline' : isStale ? 'Stale · Raw' : 'Raw sign';
    document.getElementById('val-current').textContent = isDisc ? '—' : vals.currentA.toFixed(2);
    document.getElementById('unit-current').textContent = isDisc ? 'A (Offline)' : 'A';
    var powerMagKw = Math.abs((vals.voltageV * vals.currentA) / 1000).toFixed(2);
    document.getElementById('note-current').textContent = isDisc
      ? 'Bus disconnected; direction unqualified'
      : 'Raw CAN sign (direction unqualified) · ~' + powerMagKw + ' kW';

    // Displayed Charge
    document.getElementById('ch-charge').setAttribute('data-state', channelState);
    var tagC = document.getElementById('tag-charge');
    tagC.setAttribute('data-tag', tagState);
    tagC.textContent = isDisc ? 'Offline' : isStale ? 'Stale · 15s' : sc.isRecovered ? 'Recovered' : 'SOC';
    document.getElementById('val-charge').textContent = isDisc ? '—' : vals.displayedChargePercent.toFixed(1);
    document.getElementById('unit-charge').textContent = isDisc ? '% (Offline)' : '%';
    document.getElementById('note-charge').textContent = isDisc
      ? 'No live frame; not rendered as 0%'
      : 'Sanitized parked battery capture';

    // 5. Secondary Channels: Full Pack Energy & Battery Temperatures
    var energyState = catalog.fullPackEnergyKwh.state;
    var chEnergy = document.getElementById('ch-energy');
    var tagEnergy = document.getElementById('tag-energy');
    var valEnergy = document.getElementById('val-energy');
    var unitEnergy = document.getElementById('unit-energy');
    var noteEnergy = document.getElementById('note-energy');

    chEnergy.setAttribute('data-state', energyState);
    if (energyState === 'unavailable') {
      tagEnergy.setAttribute('data-tag', 'unavail');
      tagEnergy.textContent = 'Unavailable · 10s';
      valEnergy.textContent = 'Unavailable';
      unitEnergy.textContent = 'kWh';
      noteEnergy.textContent = 'fullPackEnergyKwh absent at t=10s (distinct from 0 kWh)';
    } else if (energyState === 'disconnected') {
      tagEnergy.setAttribute('data-tag', 'offline');
      tagEnergy.textContent = 'Offline · 20s';
      valEnergy.textContent = '—';
      unitEnergy.textContent = 'kWh (Offline)';
      noteEnergy.textContent = 'Stream disconnected; energy frame unavailable';
    } else if (energyState === 'stale') {
      tagEnergy.setAttribute('data-tag', 'stale');
      tagEnergy.textContent = 'Stale · 15s';
      valEnergy.textContent = vals.fullPackEnergyKwh.toFixed(1);
      unitEnergy.textContent = 'kWh (Stale)';
      noteEnergy.textContent = 'Last received 80.5 kWh aged past freshness window';
    } else {
      tagEnergy.setAttribute('data-tag', 'valid');
      tagEnergy.textContent = sc.isRecovered ? 'Recovered' : 'Valid';
      valEnergy.textContent = vals.fullPackEnergyKwh.toFixed(1);
      unitEnergy.textContent = 'kWh';
      var estRem = ((vals.fullPackEnergyKwh * vals.displayedChargePercent) / 100).toFixed(1);
      noteEnergy.textContent = 'Nominal full pack · ~' + estRem + ' kWh proportional at 67.2%';
    }

    // Battery Temperatures
    var chTemp = document.getElementById('ch-temp');
    var tagTemp = document.getElementById('tag-temp');
    var valTemp = document.getElementById('val-temp');
    var unitTemp = document.getElementById('unit-temp');
    var noteTemp = document.getElementById('note-temp');
    var tempBar = document.getElementById('temp-bar-window');

    chTemp.setAttribute('data-state', channelState);
    var tMin = vals.minimumTemperatureC;
    var tMax = vals.maximumTemperatureC;
    var tDelta = tMax - tMin;

    if (isDisc) {
      tagTemp.setAttribute('data-tag', 'offline');
      tagTemp.textContent = 'Offline';
      valTemp.textContent = '— / —';
      unitTemp.textContent = '°C (Offline)';
      noteTemp.textContent = 'Thermistor frames offline';
      tempBar.style.opacity = '0.2';
    } else {
      tagTemp.setAttribute('data-tag', tagState);
      tagTemp.textContent = (isStale ? 'Stale · ' : '') + 'Δ ' + tDelta.toFixed(1) + ' °C';
      valTemp.textContent = tMin.toFixed(1) + ' – ' + tMax.toFixed(1);
      unitTemp.textContent = '°C';
      noteTemp.textContent = 'Min ' + tMin.toFixed(1) + '°C · Max ' + tMax.toFixed(1) + '°C';
      tempBar.style.opacity = '1';
      var leftPct = (tMin / 50) * 100;
      var widthPct = Math.max(6, ((tMax - tMin) / 50) * 100);
      tempBar.style.left = leftPct.toFixed(1) + '%';
      tempBar.style.width = widthPct.toFixed(1) + '%';
    }

    // 6. Render 25-Second Replay Timeline & Signal Trace SVG
    renderHistoryTraceSVG(sc);
  }

  function renderHistoryTraceSVG(sc) {
    var wrap = document.getElementById('history-svg-wrap');
    var cursorNote = document.getElementById('history-cursor-note');

    // Timeline spans 0s to 28s across x = 48..410
    var w = 424;
    var h = 84;
    var x0 = 52;
    var xEnd = 412;
    var spanW = xEnd - x0;

    function secToX(s) {
      return x0 + (s / 28) * spanW;
    }

    var xAt0 = secToX(0);
    var xAt10 = secToX(10);
    var xAt15 = secToX(15);
    var xAt20 = secToX(20);
    var xAt25 = secToX(25);
    var xAt28 = secToX(28);
    var cursorX = secToX(sc.atSeconds);

    var svg =
      '<svg class="history-svg" id="replay-timeline-svg" viewBox="0 0 ' +
      w +
      ' ' +
      h +
      '" role="img" aria-label="25-second replay timeline trace showing connected, energy unavailable, stale, disconnected gap, and recovered states">' +
      // Background bands for scenarios
      '<rect x="' +
      xAt10.toFixed(1) +
      '" y="6" width="' +
      (xAt20 - xAt10).toFixed(1) +
      '" height="56" fill="var(--accent-amber-soft)" rx="2" />' +
      '<rect x="' +
      xAt20.toFixed(1) +
      '" y="6" width="' +
      (xAt25 - xAt20).toFixed(1) +
      '" height="56" fill="var(--accent-fault-soft)" rx="2" />' +
      // Track labels on left
      '<text x="4" y="24" fill="var(--text-secondary)" font-size="9.5" font-weight="600">Pack V/%</text>' +
      '<text x="4" y="50" fill="var(--text-secondary)" font-size="9.5" font-weight="600">Energy</text>' +
      // Track 1: Pack Voltage / SOC (Valid 0-15s, Stale 15-20s, Open Gap 20-25s, Recovered 25-28s)
      '<line x1="' +
      xAt0.toFixed(1) +
      '" y1="20" x2="' +
      xAt15.toFixed(1) +
      '" y2="20" stroke="var(--accent-primary)" stroke-width="3" stroke-linecap="round" />' +
      '<line x1="' +
      xAt15.toFixed(1) +
      '" y1="20" x2="' +
      xAt20.toFixed(1) +
      '" y2="20" stroke="var(--accent-amber)" stroke-width="3" stroke-dasharray="4 3" />' +
      // Explicit open disconnect gap 20-25s (no line drawn at 0!)
      '<text x="' +
      ((xAt20 + xAt25) / 2).toFixed(1) +
      '" y="36" text-anchor="middle" fill="var(--accent-fault)" font-family="var(--font-telemetry)" font-size="8.5" font-weight="700">GAP (NO DATA)</text>' +
      '<line x1="' +
      xAt25.toFixed(1) +
      '" y1="20" x2="' +
      xAt28.toFixed(1) +
      '" y2="20" stroke="var(--accent-nominal)" stroke-width="3" stroke-linecap="round" />' +
      // Track 2: Full Pack Energy (Valid 0-10s, Unavailable 10-15s, Stale 15-20s, Gap 20-25s, Recovered 25-28s)
      '<line x1="' +
      xAt0.toFixed(1) +
      '" y1="47" x2="' +
      xAt10.toFixed(1) +
      '" y2="47" stroke="var(--accent-nominal)" stroke-width="3" stroke-linecap="round" />' +
      '<rect x="' +
      (xAt10 + 2).toFixed(1) +
      '" y="41" width="' +
      (xAt15 - xAt10 - 4).toFixed(1) +
      '" height="12" fill="none" stroke="var(--accent-amber)" stroke-width="1.2" stroke-dasharray="3 2" rx="2" />' +
      '<text x="' +
      ((xAt10 + xAt15) / 2).toFixed(1) +
      '" y="50" text-anchor="middle" fill="var(--accent-amber)" font-family="var(--font-telemetry)" font-size="8" font-weight="700">UNAVAIL</text>' +
      '<line x1="' +
      xAt15.toFixed(1) +
      '" y1="47" x2="' +
      xAt20.toFixed(1) +
      '" y2="47" stroke="var(--accent-amber)" stroke-width="2.5" stroke-dasharray="3 3" />' +
      '<line x1="' +
      xAt25.toFixed(1) +
      '" y1="47" x2="' +
      xAt28.toFixed(1) +
      '" y2="47" stroke="var(--accent-nominal)" stroke-width="3" stroke-linecap="round" />' +
      // Interactive event markers at 0s, 10s, 15s, 20s, 25s
      renderTimelineNode(xAt0, '0s Live', sc.index === 0) +
      renderTimelineNode(xAt10, '10s Unav', sc.index === 1) +
      renderTimelineNode(xAt15, '15s Stale', sc.index === 2) +
      renderTimelineNode(xAt20, '20s Disc', sc.index === 3) +
      renderTimelineNode(xAt25, '25s Recov', sc.index === 4) +
      // Active Playhead Cursor
      '<line x1="' +
      cursorX.toFixed(1) +
      '" y1="4" x2="' +
      cursorX.toFixed(1) +
      '" y2="64" stroke="var(--text-primary)" stroke-width="2" />' +
      '<circle cx="' +
      cursorX.toFixed(1) +
      '" cy="20" r="4" fill="var(--text-primary)" />' +
      '</svg>';

    wrap.innerHTML = svg;

    var descriptions = [
      't=0s (Connected): All signals valid (377.63 V, -0.60 A unqualified sign, 67.2%).',
      't=10s (Unavailable): fullPackEnergyKwh absent on bus; never rendered as 0 kWh.',
      't=15s (Stale): Frame age threshold exceeded; last readings marked Stale.',
      't=20s (Disconnected): CAN stream offline; open break in trace (never zero).',
      't=25s (Recovered): Bus reconnected; fullPackEnergyKwh (80.5 kWh) restored.'
    ];
    cursorNote.textContent = descriptions[sc.index];

    var svgEl = document.getElementById('replay-timeline-svg');
    if (svgEl) {
      svgEl.onclick = function (ev) {
        var rect = svgEl.getBoundingClientRect();
        var relX = ((ev.clientX - rect.left) / rect.width) * w;
        var sec = ((relX - x0) / spanW) * 28;
        var targets = [0, 10, 15, 20, 25];
        var bestIdx = 0;
        var bestDist = 999;
        for (var i = 0; i < targets.length; i++) {
          var d = Math.abs(sec - targets[i]);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        setScenario(bestIdx);
      };
    }
  }

  function renderTimelineNode(x, label, isActive) {
    return (
      '<g>' +
      '<line x1="' +
      x.toFixed(1) +
      '" y1="6" x2="' +
      x.toFixed(1) +
      '" y2="62" stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="2 2" />' +
      '<text x="' +
      x.toFixed(1) +
      '" y="76" text-anchor="middle" fill="' +
      (isActive ? 'var(--accent-primary)' : 'var(--text-muted)') +
      '" font-family="var(--font-telemetry)" font-size="9.5" font-weight="' +
      (isActive ? '700' : '500') +
      '">' +
      label +
      '</text>' +
      '</g>'
    );
  }

  /* ------------------------------------------------------------------------
     VIEW 2: CELLS (96-Group Pack Matrix, Spread Chart & Group Inspector)
     ------------------------------------------------------------------------ */
  function buildCellsMatrixDOM() {
    var container = document.getElementById('cells-banks-container');
    var groups = state.fixture.cellGroups;
    var cs = state.cellStats;
    container.innerHTML = '';

    for (var b = 0; b < 4; b++) {
      var startIdx = b * 24;
      var endIdx = startIdx + 24;
      var bankGroups = groups.slice(startIdx, endIdx);

      var bankMin = bankGroups[0].voltageV;
      var bankMax = bankGroups[0].voltageV;
      for (var k = 0; k < bankGroups.length; k++) {
        if (bankGroups[k].voltageV < bankMin) bankMin = bankGroups[k].voltageV;
        if (bankGroups[k].voltageV > bankMax) bankMax = bankGroups[k].voltageV;
      }

      var bankEl = document.createElement('div');
      bankEl.className = 'cell-bank';

      var headerEl = document.createElement('div');
      headerEl.className = 'bank-header';
      headerEl.innerHTML =
        '<span>Bank ' +
        (b + 1) +
        ' · Groups ' +
        pad2(startIdx + 1) +
        '–' +
        pad2(endIdx) +
        '</span>' +
        '<span class="bank-range-label" data-bank="' +
        b +
        '">' +
        bankMin.toFixed(4) +
        '–' +
        bankMax.toFixed(4) +
        ' V</span>';
      bankEl.appendChild(headerEl);

      var gridEl = document.createElement('div');
      gridEl.className = 'bank-grid';

      for (var j = 0; j < bankGroups.length; j++) {
        var g = bankGroups[j];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cell-pill';
        btn.setAttribute('data-cell-index', String(g.index));
        if (g.index === cs.minGroup.index) btn.classList.add('is-min');
        if (g.voltageV === cs.maxGroup.voltageV) btn.classList.add('is-max');

        var norm = (g.voltageV - cs.minGroup.voltageV) / (cs.maxGroup.voltageV - cs.minGroup.voltageV || 0.001);
        var barColor =
          norm < 0.33 ? 'var(--cell-low)' : norm > 0.78 ? 'var(--cell-high)' : 'var(--cell-mid)';

        btn.innerHTML =
          '<span class="cell-idx">#' +
          pad2(g.index) +
          '</span>' +
          '<span class="cell-mv" id="cell-mv-' +
          g.index +
          '">.' +
          g.voltageV.toFixed(4).slice(2) +
          '</span>' +
          '<span class="cell-bar-indicator" style="background:' +
          barColor +
          '; width:' +
          Math.round(35 + norm * 55) +
          '%;"></span>';

        (function (cellIdx) {
          btn.onclick = function () {
            selectCellGroup(cellIdx);
          };
        })(g.index);

        gridEl.appendChild(btn);
      }

      bankEl.appendChild(gridEl);
      container.appendChild(bankEl);
    }
  }

  function renderCellsProfileSVG() {
    var host = document.getElementById('cells-profile-svg-host');
    var groups = state.fixture.cellGroups;
    var cs = state.cellStats;
    var sc = getCurrentScenario();
    var isDisc = sc.streamState === 'disconnected';

    var w = 480;
    var h = 250;
    var padL = 44;
    var padR = 10;
    var padT = 14;
    var padB = 24;
    var plotW = w - padL - padR;
    var plotH = h - padT - padB;

    var vFloor = 3.9304;
    var vCeil = 3.9349;

    function vToY(v) {
      return padT + (1 - (v - vFloor) / (vCeil - vFloor)) * plotH;
    }

    var yMean = vToY(cs.meanV);
    var barsHtml = '';

    if (isDisc) {
      barsHtml =
        '<rect x="' +
        padL +
        '" y="' +
        padT +
        '" width="' +
        plotW +
        '" height="' +
        plotH +
        '" fill="var(--accent-fault-soft)" stroke="var(--accent-fault)" stroke-dasharray="4 3" rx="4" />' +
        '<text x="' +
        (padL + plotW / 2) +
        '" y="' +
        (padT + plotH / 2) +
        '" text-anchor="middle" fill="var(--accent-fault)" font-family="var(--font-telemetry)" font-size="13" font-weight="700">CAN BUS DISCONNECTED (t=20s) — 96-GROUP TELEMETRY OFFLINE (NEVER RENDERED AS 0V)</text>';
    } else {
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        var x = padL + ((i + 0.5) / 96) * plotW;
        var yMin = vToY(g.minimumV);
        var yMax = vToY(g.maximumV);
        var yVal = vToY(g.voltageV);
        var isSel = g.index === state.selectedCellIndex;
        var col =
          g.index === cs.minGroup.index
            ? 'var(--cell-low)'
            : g.voltageV === cs.maxGroup.voltageV
            ? 'var(--cell-high)'
            : 'var(--cell-mid)';

        if (isSel) {
          barsHtml +=
            '<line x1="' +
            x.toFixed(1) +
            '" y1="' +
            padT +
            '" x2="' +
            x.toFixed(1) +
            '" y2="' +
            (padT + plotH) +
            '" stroke="var(--accent-primary)" stroke-width="1.5" stroke-dasharray="2 2" />';
        }

        barsHtml +=
          '<line x1="' +
          x.toFixed(1) +
          '" y1="' +
          yMax.toFixed(1) +
          '" x2="' +
          x.toFixed(1) +
          '" y2="' +
          yMin.toFixed(1) +
          '" stroke="' +
          col +
          '" stroke-width="' +
          (isSel ? '3.5' : '2') +
          '" />' +
          '<circle cx="' +
          x.toFixed(1) +
          '" cy="' +
          yVal.toFixed(1) +
          '" r="' +
          (isSel ? '3.2' : '1.6') +
          '" fill="' +
          (isSel ? 'var(--text-primary)' : col) +
          '" />';
      }
    }

    var svg =
      '<svg class="profile-svg" id="cells-profile-svg" viewBox="0 0 ' +
      w +
      ' ' +
      h +
      '" role="img" aria-label="96 cell group voltage spread profile">' +
      // Y-axis grid lines
      '<line x1="' +
      padL +
      '" y1="' +
      vToY(3.9345).toFixed(1) +
      '" x2="' +
      (w - padR) +
      '" y2="' +
      vToY(3.9345).toFixed(1) +
      '" stroke="var(--border-subtle)" stroke-dasharray="2 2" />' +
      '<text x="2" y="' +
      (vToY(3.9345) + 3).toFixed(1) +
      '" fill="var(--text-muted)" font-family="var(--font-telemetry)" font-size="9">3.9345V</text>' +
      '<line x1="' +
      padL +
      '" y1="' +
      yMean.toFixed(1) +
      '" x2="' +
      (w - padR) +
      '" y2="' +
      yMean.toFixed(1) +
      '" stroke="var(--accent-primary)" stroke-width="1" stroke-dasharray="4 3" />' +
      '<text x="2" y="' +
      (yMean + 3).toFixed(1) +
      '" fill="var(--accent-primary)" font-family="var(--font-telemetry)" font-size="9">Mean</text>' +
      '<line x1="' +
      padL +
      '" y1="' +
      vToY(3.9309).toFixed(1) +
      '" x2="' +
      (w - padR) +
      '" y2="' +
      vToY(3.9309).toFixed(1) +
      '" stroke="var(--border-subtle)" stroke-dasharray="2 2" />' +
      '<text x="2" y="' +
      (vToY(3.9309) + 3).toFixed(1) +
      '" fill="var(--text-muted)" font-family="var(--font-telemetry)" font-size="9">3.9309V</text>' +
      barsHtml +
      '<text x="' +
      padL +
      '" y="' +
      (h - 6) +
      '" fill="var(--text-muted)" font-family="var(--font-telemetry)" font-size="9.5">Group #01</text>' +
      '<text x="' +
      (padL + plotW * 0.25) +
      '" y="' +
      (h - 6) +
      '" fill="var(--text-muted)" font-family="var(--font-telemetry)" font-size="9.5">#24</text>' +
      '<text x="' +
      (padL + plotW * 0.5) +
      '" y="' +
      (h - 6) +
      '" fill="var(--text-muted)" font-family="var(--font-telemetry)" font-size="9.5">#48</text>' +
      '<text x="' +
      (padL + plotW * 0.75) +
      '" y="' +
      (h - 6) +
      '" fill="var(--text-muted)" font-family="var(--font-telemetry)" font-size="9.5">#72</text>' +
      '<text x="' +
      (w - padR) +
      '" y="' +
      (h - 6) +
      '" text-anchor="end" fill="var(--text-muted)" font-family="var(--font-telemetry)" font-size="9.5">#96</text>' +
      '</svg>';

    host.innerHTML = svg;

    var svgEl = document.getElementById('cells-profile-svg');
    if (svgEl) {
      svgEl.onclick = function (ev) {
        var rect = svgEl.getBoundingClientRect();
        var relX = ((ev.clientX - rect.left) / rect.width) * w;
        var idx = Math.floor(((relX - padL) / plotW) * 96) + 1;
        idx = Math.max(1, Math.min(96, idx));
        selectCellGroup(idx);
      };
    }
  }

  function renderCellsView() {
    var sc = getCurrentScenario();
    var cs = state.cellStats;
    var groups = state.fixture.cellGroups;
    var isDisc = sc.streamState === 'disconnected';
    var isStale = sc.streamState === 'stale';

    document.getElementById('cells-nominal-spread').textContent = isDisc
      ? 'Offline (Disconnected)'
      : cs.nominalSpreadMv.toFixed(1) +
        ' mV (' +
        cs.minGroup.voltageV.toFixed(4) +
        '–' +
        cs.maxGroup.voltageV.toFixed(4) +
        'V)';
    document.getElementById('cells-envelope-spread').textContent = isDisc
      ? 'Offline (— mV)'
      : cs.envelopeSpreadMv.toFixed(1) +
        ' mV (' +
        cs.envMinV.toFixed(4) +
        '–' +
        cs.envMaxV.toFixed(4) +
        'V)';
    document.getElementById('cells-mean-val').textContent = isDisc
      ? '— V'
      : cs.meanV.toFixed(4) + ' V' + (isStale ? ' (Stale)' : '');

    // Update matrix cells selection and values
    var pills = document.querySelectorAll('.cell-pill');
    for (var i = 0; i < pills.length; i++) {
      var pill = pills[i];
      var idx = parseInt(pill.getAttribute('data-cell-index'), 10);
      pill.classList.toggle('is-selected', idx === state.selectedCellIndex);
      var mvEl = document.getElementById('cell-mv-' + idx);
      if (mvEl) {
        mvEl.textContent = isDisc ? '—' : '.' + groups[idx - 1].voltageV.toFixed(4).slice(2);
      }
    }

    // Update profile chart if visible
    if (state.cellsViewMode === 'profile') {
      renderCellsProfileSVG();
    }

    // Render Inspector for selectedCellIndex
    var selGroup = groups[state.selectedCellIndex - 1];
    var bankNum = Math.floor((selGroup.index - 1) / 24) + 1;
    document.getElementById('insp-group-title').textContent =
      'Group #' + pad2(selGroup.index) + ' / 96';

    var mainV = document.getElementById('insp-voltage-main');
    var minV = document.getElementById('insp-min-v');
    var maxV = document.getElementById('insp-max-v');
    var winMv = document.getElementById('insp-window-mv');
    var dMean = document.getElementById('insp-delta-mean');
    var dMinMax = document.getElementById('insp-delta-minmax');
    var stEl = document.getElementById('insp-state');
    var badgesEl = document.getElementById('insp-badges');

    var badgeHtml = '<span class="inspector-badge">Bank ' + bankNum + '</span>';
    if (selGroup.index === cs.minGroup.index) {
      badgeHtml += '<span class="inspector-badge" style="border-color:var(--cell-low);color:var(--cell-low);">Pack Lowest (#01)</span>';
    }
    if (selGroup.voltageV === cs.maxGroup.voltageV) {
      badgeHtml += '<span class="inspector-badge" style="border-color:var(--cell-high);color:var(--cell-high);">Pack Peak Plateau</span>';
    }
    if (isStale) {
      badgeHtml += '<span class="inspector-badge" style="border-color:var(--accent-amber);color:var(--accent-amber);">Stale (15s)</span>';
    } else if (isDisc) {
      badgeHtml += '<span class="inspector-badge" style="border-color:var(--accent-fault);color:var(--accent-fault);">Disconnected (20s)</span>';
    }
    badgesEl.innerHTML = badgeHtml;

    if (isDisc) {
      mainV.textContent = 'Offline (— V)';
      minV.textContent = '— V';
      maxV.textContent = '— V';
      winMv.textContent = '— mV';
      dMean.textContent = '— mV';
      dMinMax.textContent = '— / — mV';
      stEl.textContent = 'disconnected (not 0 V)';
    } else {
      mainV.textContent = selGroup.voltageV.toFixed(4) + ' V';
      minV.textContent = selGroup.minimumV.toFixed(4) + ' V';
      maxV.textContent = selGroup.maximumV.toFixed(4) + ' V';
      var intraMv = (selGroup.maximumV - selGroup.minimumV) * 1000;
      winMv.textContent = intraMv.toFixed(2) + ' mV';

      var diffMeanMv = (selGroup.voltageV - cs.meanV) * 1000;
      dMean.textContent = (diffMeanMv >= 0 ? '+' : '') + diffMeanMv.toFixed(2) + ' mV';

      var aboveMinMv = (selGroup.voltageV - cs.minGroup.voltageV) * 1000;
      var belowMaxMv = (selGroup.voltageV - cs.maxGroup.voltageV) * 1000;
      dMinMax.textContent =
        '+' + aboveMinMv.toFixed(1) + ' / ' + belowMaxMv.toFixed(1) + ' mV';
      stEl.textContent = isStale ? 'stale (last valid)' : selGroup.state;
    }

    // Inspector Envelope Micro-SVG
    var envHost = document.getElementById('insp-envelope-svg-host');
    if (isDisc) {
      envHost.innerHTML =
        '<div style="font-size:11px;color:var(--accent-fault);padding:4px 0;">Bus offline — envelope comparison paused until recovery.</div>';
    } else {
      var span = cs.envMaxV - cs.envMinV || 0.001;
      var xMinPct = ((selGroup.minimumV - cs.envMinV) / span) * 100;
      var xMaxPct = ((selGroup.maximumV - cs.envMinV) / span) * 100;
      var xValPct = ((selGroup.voltageV - cs.envMinV) / span) * 100;
      var xMeanPct = ((cs.meanV - cs.envMinV) / span) * 100;

      envHost.innerHTML =
        '<svg viewBox="0 0 220 34" width="100%" height="34" role="img" aria-label="Cell group position within pack voltage envelope">' +
        '<rect x="6" y="8" width="208" height="8" rx="4" fill="var(--gauge-track)" />' +
        '<line x1="' +
        (6 + (xMeanPct / 100) * 208).toFixed(1) +
        '" y1="4" x2="' +
        (6 + (xMeanPct / 100) * 208).toFixed(1) +
        '" y2="20" stroke="var(--text-muted)" stroke-width="1.2" stroke-dasharray="2 1" />' +
        '<rect x="' +
        (6 + (xMinPct / 100) * 208).toFixed(1) +
        '" y="7" width="' +
        Math.max(4, ((xMaxPct - xMinPct) / 100) * 208).toFixed(1) +
        '" height="10" rx="2" fill="var(--accent-primary)" opacity="0.65" />' +
        '<circle cx="' +
        (6 + (xValPct / 100) * 208).toFixed(1) +
        '" cy="12" r="4.5" fill="var(--accent-primary)" stroke="var(--bg-well)" stroke-width="1.5" />' +
        '<text x="6" y="31" fill="var(--text-muted)" font-family="var(--font-telemetry)" font-size="9">3.9307V</text>' +
        '<text x="110" y="31" text-anchor="middle" fill="var(--text-secondary)" font-family="var(--font-telemetry)" font-size="9">Mean 3.9333V</text>' +
        '<text x="214" y="31" text-anchor="end" fill="var(--text-muted)" font-family="var(--font-telemetry)" font-size="9">3.9346V</text>' +
        '</svg>';
    }
  }

  function selectCellGroup(index) {
    state.selectedCellIndex = Math.max(1, Math.min(96, index));
    renderCellsView();
  }

  /* ------------------------------------------------------------------------
     VIEW 3: PERFORMANCE (Simulated Results & Timing Conventions)
     ------------------------------------------------------------------------ */
  function renderPerformanceView() {
    var perf = state.fixture.performanceDemo;
    var vals = state.fixture.values;
    var sc = getCurrentScenario();

    document.getElementById('perf-note-banner').textContent =
      perf.note + ' (mode: ' + perf.mode + ')';
    document.getElementById('perf-rollout-pill').textContent =
      'Rollout convention: ' + perf.rollout + ' (0.0 ft subtracted)';
    document.getElementById('perf-0to60-val').textContent = perf.zeroTo60MphSeconds.toFixed(1);
    document.getElementById('perf-quarter-val').textContent = perf.quarterMileSeconds.toFixed(1);
    document.getElementById('perf-power-val').textContent = String(perf.peakBatteryPowerKw);

    var liveCtxEl = document.getElementById('perf-live-context');
    if (sc.streamState === 'disconnected') {
      liveCtxEl.textContent = 'Replay stream currently disconnected at t=20s';
    } else {
      liveCtxEl.textContent =
        vals.voltageV.toFixed(2) +
        ' V, ' +
        vals.currentA.toFixed(2) +
        ' A (unqualified sign), ' +
        vals.displayedChargePercent.toFixed(1) +
        '% SOC, ' +
        vals.minimumTemperatureC.toFixed(1) +
        '–' +
        vals.maximumTemperatureC.toFixed(1) +
        ' °C';
    }

    var captionEl = document.getElementById('perf-curve-caption');
    if (state.perfRolloutCompare) {
      captionEl.textContent =
        'Simulated comparison: Fixture rollout: none = 4.9 s (0–60 mph) vs. hypothetical 1-ft rollout convention (~4.65 s simulated reference).';
    } else {
      captionEl.textContent =
        'Standing start (rollout: none) clocks from initial movement; 0–60 mph reached at 4.9 s, 1/4 mile at 13.2 s, 280 kW peak simulated power.';
    }

    // Render Simulated Curve SVG
    var host = document.getElementById('perf-curve-svg-host');
    var w = 420;
    var h = 148;
    var svg =
      '<svg class="perf-curve-svg" viewBox="0 0 ' +
      w +
      ' ' +
      h +
      '" role="img" aria-label="Simulated acceleration and battery power curve">' +
      '<line x1="36" y1="18" x2="404" y2="18" stroke="var(--border-subtle)" stroke-dasharray="2 2" />' +
      '<line x1="36" y1="68" x2="404" y2="68" stroke="var(--border-subtle)" stroke-dasharray="2 2" />' +
      '<line x1="36" y1="118" x2="404" y2="118" stroke="var(--border-strong)" />' +
      // Power curve (Simulated 280 kW peak plateau tapering after 5s)
      '<path d="M 36 118 L 62 24 L 172 24 Q 260 32 404 62" fill="none" stroke="var(--accent-amber)" stroke-width="2.5" stroke-dasharray="5 3" />' +
      // Velocity curve (0 to 60 mph at 4.9s -> x=172, 1/4 mile at 13.2s -> x=404)
      '<path d="M 36 118 Q 105 70 172 52 T 404 18" fill="none" stroke="var(--accent-primary)" stroke-width="3" />' +
      (state.perfRolloutCompare
        ? '<path d="M 46 118 Q 110 68 165 52 T 396 18" fill="none" stroke="var(--accent-nominal)" stroke-width="2" stroke-dasharray="3 3" />'
        : '') +
      // 4.9s marker
      '<line x1="172" y1="14" x2="172" y2="118" stroke="var(--accent-primary)" stroke-width="1.2" stroke-dasharray="3 2" />' +
      '<circle cx="172" cy="52" r="4" fill="var(--accent-primary)" />' +
      '<text x="176" y="48" fill="var(--text-primary)" font-family="var(--font-telemetry)" font-size="9.5" font-weight="700">4.9 s · 60 mph (Sim)</text>' +
      // Peak power marker
      '<circle cx="115" cy="24" r="4" fill="var(--accent-amber)" />' +
      '<text x="70" y="16" fill="var(--accent-amber)" font-family="var(--font-telemetry)" font-size="9.5" font-weight="700">280 kW Peak (Sim)</text>' +
      // 13.2s 1/4 mile marker
      '<circle cx="404" cy="18" r="4" fill="var(--accent-primary)" />' +
      '<text x="398" y="34" text-anchor="end" fill="var(--text-primary)" font-family="var(--font-telemetry)" font-size="9.5" font-weight="700">13.2 s · 1/4 mi (Sim)</text>' +
      // Axis labels
      '<text x="36" y="134" fill="var(--text-muted)" font-family="var(--font-telemetry)" font-size="9.5">0.0 s start</text>' +
      '<text x="172" y="134" text-anchor="middle" fill="var(--text-muted)" font-family="var(--font-telemetry)" font-size="9.5">4.9 s (60 mph)</text>' +
      '<text x="404" y="134" text-anchor="end" fill="var(--text-muted)" font-family="var(--font-telemetry)" font-size="9.5">13.2 s (1/4 mi)</text>' +
      '</svg>';

    host.innerHTML = svg;
  }

  /* ------------------------------------------------------------------------
     VIEW 4: CONVENIENCE CONTROLS (Simulated Pending / Confirmed / Unconfirmed)
     ------------------------------------------------------------------------ */
  var ACTION_META = {
    glovebox: {
      title: 'Glovebox',
      subtitle: 'Cabin latch release (Simulated)',
      iconSvg:
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M10 12h4"/><path d="M12 12v3"/></svg>',
      defaultTargetOutcome: 'confirmed'
    },
    'fold mirrors': {
      title: 'Fold mirrors',
      subtitle: 'Side mirror actuator (Simulated)',
      iconSvg:
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h11a3 3 0 0 1 3 3v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z"/><path d="M18 12h3"/></svg>',
      defaultTargetOutcome: 'confirmed'
    },
    'charge port': {
      title: 'Charge port',
      subtitle: 'Port door unlatch (Simulated)',
      iconSvg:
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/></svg>',
      defaultTargetOutcome: 'unconfirmed'
    }
  };

  function initControlStates() {
    var actions = state.fixture.controlDemo.actions;
    // Set initial states so all three outcomes ('pending', 'confirmed', 'unconfirmed') are immediately visible and testable!
    var initialOutcomes = ['confirmed', 'pending', 'unconfirmed'];
    for (var i = 0; i < actions.length; i++) {
      var act = actions[i];
      state.controlStates[act] = {
        outcome: initialOutcomes[i % initialOutcomes.length],
        timer: null
      };
    }
  }

  function buildControlsDOM() {
    var grid = document.getElementById('controls-tiles-grid');
    var actions = state.fixture.controlDemo.actions;
    var outcomes = state.fixture.controlDemo.outcomes; // ['pending', 'confirmed', 'unconfirmed']
    grid.innerHTML = '';

    for (var i = 0; i < actions.length; i++) {
      var actionKey = actions[i];
      var meta = ACTION_META[actionKey] || {
        title: actionKey,
        subtitle: 'Simulated convenience action',
        iconSvg: '',
        defaultTargetOutcome: 'confirmed'
      };

      var tile = document.createElement('div');
      tile.className = 'control-tile';
      tile.id = 'control-tile-' + i;

      var pillsHtml = '';
      for (var j = 0; j < outcomes.length; j++) {
        var outKey = outcomes[j];
        var outLabel =
          outKey === 'confirmed'
            ? 'Confirmed'
            : outKey === 'unconfirmed'
            ? 'Unconfirmed'
            : 'Pending';
        pillsHtml +=
          '<button type="button" class="outcome-pill-btn" data-action="' +
          actionKey +
          '" data-outcome="' +
          outKey +
          '" aria-pressed="false">' +
          outLabel +
          '</button>';
      }

      tile.innerHTML =
        '<div class="tile-header">' +
        '  <div class="tile-header-top">' +
        '    <div class="tile-title-group">' +
        '      <div class="tile-icon" aria-hidden="true">' +
        meta.iconSvg +
        '</div>' +
        '      <div>' +
        '        <div class="tile-name">' +
        meta.title +
        '</div>' +
        '        <div class="tile-sub">' +
        meta.subtitle +
        '</div>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '  <span class="outcome-badge" id="outcome-badge-' +
        i +
        '" data-outcome="pending">Simulated · Pending</span>' +
        '</div>' +
        '<button type="button" class="tile-trigger-btn" id="tile-trigger-' +
        i +
        '" data-action="' +
        actionKey +
        '">' +
        '  <span>Simulate "' +
        meta.title +
        '"</span>' +
        '</button>' +
        '<div class="outcome-selector-group">' +
        '  <span class="outcome-selector-label">Set simulated outcome state directly:</span>' +
        '  <div class="outcome-pills">' +
        pillsHtml +
        '  </div>' +
        '</div>' +
        '<div class="tile-feedback-box" id="tile-feedback-' +
        i +
        '"></div>';

      grid.appendChild(tile);
    }

    // Bind trigger buttons
    var triggerBtns = grid.querySelectorAll('.tile-trigger-btn');
    for (var t = 0; t < triggerBtns.length; t++) {
      (function (btn) {
        btn.onclick = function () {
          var actKey = btn.getAttribute('data-action');
          triggerSimulatedControl(actKey);
        };
      })(triggerBtns[t]);
    }

    // Bind direct outcome pills
    var pillBtns = grid.querySelectorAll('.outcome-pill-btn');
    for (var p = 0; p < pillBtns.length; p++) {
      (function (btn) {
        btn.onclick = function () {
          var actKey = btn.getAttribute('data-action');
          var outKey = btn.getAttribute('data-outcome');
          setControlOutcome(actKey, outKey, 'Direct state selection');
        };
      })(pillBtns[p]);
    }
  }

  function setControlOutcome(actionKey, outcomeKey, reason) {
    var entry = state.controlStates[actionKey];
    if (!entry) return;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.outcome = outcomeKey;
    appendControlLog(actionKey, outcomeKey, reason);
    renderControlsView();
  }

  function triggerSimulatedControl(actionKey) {
    var entry = state.controlStates[actionKey];
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);

    var sc = getCurrentScenario();
    entry.outcome = 'pending';
    appendControlLog(actionKey, 'pending', 'Simulated trigger started (no CAN transmit)');
    renderControlsView();

    var nextOutcome =
      sc.streamState === 'disconnected'
        ? 'unconfirmed'
        : actionKey === 'charge port'
        ? 'unconfirmed'
        : 'confirmed';

    entry.timer = setTimeout(function () {
      entry.outcome = nextOutcome;
      entry.timer = null;
      appendControlLog(
        actionKey,
        nextOutcome,
        nextOutcome === 'confirmed'
          ? 'Simulated status bit confirmed (success)'
          : 'Simulated confirmation window elapsed (unconfirmed)'
      );
      renderControlsView();
    }, 450);
  }

  function appendControlLog(actionKey, outcomeKey, note) {
    var logHost = document.getElementById('controls-log-entries');
    if (!logHost) return;
    var chip = document.createElement('span');
    chip.className = 'log-chip';
    var label =
      outcomeKey === 'confirmed'
        ? 'CONFIRMED (SUCCESS)'
        : outcomeKey === 'unconfirmed'
        ? 'UNCONFIRMED'
        : 'PENDING';
    chip.textContent = '[SIMULATED] ' + actionKey + ' → ' + label + ' · ' + note;
    logHost.insertBefore(chip, logHost.firstChild);
    while (logHost.children.length > 5) {
      logHost.removeChild(logHost.lastChild);
    }
  }

  function renderControlsView() {
    var actions = state.fixture.controlDemo.actions;
    for (var i = 0; i < actions.length; i++) {
      var actKey = actions[i];
      var st = state.controlStates[actKey];
      var out = st ? st.outcome : 'pending';

      var tile = document.getElementById('control-tile-' + i);
      var badge = document.getElementById('outcome-badge-' + i);
      var feedback = document.getElementById('tile-feedback-' + i);
      if (!tile || !badge || !feedback) continue;

      tile.setAttribute('data-outcome', out);
      badge.setAttribute('data-outcome', out);

      if (out === 'pending') {
        badge.textContent = 'Simulated · Pending';
        feedback.textContent =
          'Simulated pending: awaiting hypothetical CAN status frame response (realCommandsAllowed: false).';
      } else if (out === 'confirmed') {
        badge.textContent = 'Simulated · Confirmed';
        feedback.textContent =
          'Simulated confirmed (success): target status frame matched expected state in UI simulation.';
      } else if (out === 'unconfirmed') {
        badge.textContent = 'Simulated · Unconfirmed';
        feedback.textContent =
          'Simulated unconfirmed: no matching status change observed before confirmation timeout.';
      }

      var pills = tile.querySelectorAll('.outcome-pill-btn');
      for (var j = 0; j < pills.length; j++) {
        var pOut = pills[j].getAttribute('data-outcome');
        pills[j].setAttribute('aria-pressed', pOut === out ? 'true' : 'false');
      }
    }
  }

  /* ------------------------------------------------------------------------
     Global Navigation, Scenario & Theme Controls
     ------------------------------------------------------------------------ */
  function setActiveView(viewName) {
    state.activeView = viewName;
    var tabs = document.querySelectorAll('.nav-tab-btn');
    for (var i = 0; i < tabs.length; i++) {
      var v = tabs[i].getAttribute('data-view');
      tabs[i].setAttribute('aria-selected', v === viewName ? 'true' : 'false');
    }

    var panels = document.querySelectorAll('.view-panel');
    for (var j = 0; j < panels.length; j++) {
      panels[j].classList.toggle('is-active', panels[j].id === 'view-' + viewName);
    }

    renderAll();
  }

  function setScenario(idx) {
    var list = state.fixture.scenarios || FALLBACK_FIXTURE.scenarios;
    state.scenarioIdx = Math.max(0, Math.min(idx, list.length - 1));
    renderAll();
  }

  function togglePlayLoop() {
    state.isPlaying = !state.isPlaying;
    if (state.playTimer) {
      clearInterval(state.playTimer);
      state.playTimer = null;
    }
    if (state.isPlaying) {
      state.playTimer = setInterval(function () {
        var nextIdx = (state.scenarioIdx + 1) % state.fixture.scenarios.length;
        setScenario(nextIdx);
      }, 2200);
    }
    renderTopSpine();
  }

  function toggleTheme() {
    state.theme = state.theme === 'night' ? 'day' : 'night';
    document.documentElement.setAttribute('data-theme', state.theme);
    var icon = document.getElementById('theme-icon');
    var label = document.getElementById('theme-label');
    if (state.theme === 'day') {
      icon.textContent = '☾';
      label.textContent = 'Night mode';
    } else {
      icon.textContent = '☀';
      label.textContent = 'Day mode';
    }
  }

  function applyInstrumentPreset(presetName) {
    state.activePreset = presetName;
    if (presetName === 'electrical') {
      state.gaugeSlots = ['voltageV', 'displayedChargePercent', 'fullPackEnergyKwh'];
    } else if (presetName === 'cells') {
      state.gaugeSlots = ['voltageV', 'cellSpreadMv', 'currentA'];
    } else if (presetName === 'thermal') {
      state.gaugeSlots = ['displayedChargePercent', 'tempWindowC', 'fullPackEnergyKwh'];
    }

    var btns = document.querySelectorAll('.preset-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute(
        'aria-pressed',
        btns[i].getAttribute('data-preset') === presetName ? 'true' : 'false'
      );
    }
    renderOverview();
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function renderAll() {
    renderTopSpine();
    renderOverview();
    renderCellsView();
    renderPerformanceView();
    renderControlsView();
  }

  /* ------------------------------------------------------------------------
     Event Listeners & Initialization
     ------------------------------------------------------------------------ */
  function bindEvents() {
    // Navigation tabs
    var tabs = document.querySelectorAll('.nav-tab-btn');
    for (var i = 0; i < tabs.length; i++) {
      (function (tabBtn) {
        tabBtn.onclick = function () {
          setActiveView(tabBtn.getAttribute('data-view'));
        };
      })(tabs[i]);
    }

    // Scenario buttons
    var scBtns = document.querySelectorAll('.scenario-btn');
    for (var j = 0; j < scBtns.length; j++) {
      (function (btn) {
        btn.onclick = function () {
          if (state.isPlaying) togglePlayLoop();
          var idx = parseInt(btn.getAttribute('data-scenario-idx'), 10);
          setScenario(idx);
        };
      })(scBtns[j]);
    }

    // Play/Pause button
    document.getElementById('replay-play-btn').onclick = togglePlayLoop;

    // Theme toggle
    document.getElementById('theme-toggle-btn').onclick = toggleTheme;

    // Configurable gauge selects
    for (var s = 1; s <= 3; s++) {
      (function (slotIndex) {
        var sel = document.getElementById('gauge-select-' + slotIndex);
        sel.onchange = function () {
          state.gaugeSlots[slotIndex - 1] = sel.value;
          state.activePreset = 'custom';
          var pBtns = document.querySelectorAll('.preset-btn');
          for (var k = 0; k < pBtns.length; k++) {
            pBtns[k].setAttribute('aria-pressed', 'false');
          }
          renderOverview();
        };
      })(s);
    }

    // Instrument preset buttons
    var presetBtns = document.querySelectorAll('.preset-btn');
    for (var p = 0; p < presetBtns.length; p++) {
      (function (btn) {
        btn.onclick = function () {
          applyInstrumentPreset(btn.getAttribute('data-preset'));
        };
      })(presetBtns[p]);
    }

    // Cells view toolbar buttons
    document.getElementById('btn-jump-min').onclick = function () {
      selectCellGroup(state.cellStats.minGroup.index);
    };
    document.getElementById('btn-jump-max').onclick = function () {
      selectCellGroup(state.cellStats.maxGroup.index);
    };
    document.getElementById('btn-cells-matrix').onclick = function () {
      state.cellsViewMode = 'matrix';
      document.getElementById('btn-cells-matrix').setAttribute('aria-pressed', 'true');
      document.getElementById('btn-cells-profile').setAttribute('aria-pressed', 'false');
      document.getElementById('cells-banks-container').classList.remove('is-hidden');
      document.getElementById('cells-profile-wrap').classList.remove('is-visible');
      renderCellsView();
    };
    document.getElementById('btn-cells-profile').onclick = function () {
      state.cellsViewMode = 'profile';
      document.getElementById('btn-cells-matrix').setAttribute('aria-pressed', 'false');
      document.getElementById('btn-cells-profile').setAttribute('aria-pressed', 'true');
      document.getElementById('cells-banks-container').classList.add('is-hidden');
      document.getElementById('cells-profile-wrap').classList.add('is-visible');
      renderCellsView();
    };

    document.getElementById('cell-prev-btn').onclick = function () {
      var prev = state.selectedCellIndex <= 1 ? 96 : state.selectedCellIndex - 1;
      selectCellGroup(prev);
    };
    document.getElementById('cell-next-btn').onclick = function () {
      var next = state.selectedCellIndex >= 96 ? 1 : state.selectedCellIndex + 1;
      selectCellGroup(next);
    };

    // Performance rollout convention comparison buttons
    document.getElementById('btn-rollout-none').onclick = function () {
      state.perfRolloutCompare = false;
      document.getElementById('btn-rollout-none').setAttribute('aria-pressed', 'true');
      document.getElementById('btn-rollout-1ft').setAttribute('aria-pressed', 'false');
      renderPerformanceView();
    };
    document.getElementById('btn-rollout-1ft').onclick = function () {
      state.perfRolloutCompare = true;
      document.getElementById('btn-rollout-none').setAttribute('aria-pressed', 'false');
      document.getElementById('btn-rollout-1ft').setAttribute('aria-pressed', 'true');
      renderPerformanceView();
    };

    // Convenience controls demo & reset buttons
    document.getElementById('btn-controls-cycle').onclick = function () {
      var actions = state.fixture.controlDemo.actions;
      var outcomes = ['pending', 'confirmed', 'unconfirmed'];
      for (var c = 0; c < actions.length; c++) {
        var cur = state.controlStates[actions[c]].outcome;
        var nextIdx = (outcomes.indexOf(cur) + 1) % outcomes.length;
        setControlOutcome(actions[c], outcomes[nextIdx], 'Cycled demo state');
      }
    };
    document.getElementById('btn-controls-reset').onclick = function () {
      initControlStates();
      appendControlLog('all tiles', 'pending', 'Reset to baseline demo states');
      renderControlsView();
    };
  }

  function hydrateWithFixture(data) {
    if (data && data.values && Array.isArray(data.cellGroups) && data.cellGroups.length > 0) {
      state.fixture = data;
    }
    state.cellStats = computeCellStats(state.fixture.cellGroups);
    document.getElementById('fixture-source-label').textContent = state.fixture.source;
    initControlStates();
    buildCellsMatrixDOM();
    buildControlsDOM();
    renderAll();
  }

  function init() {
    state.cellStats = computeCellStats(state.fixture.cellGroups);
    initControlStates();
    buildCellsMatrixDOM();
    buildControlsDOM();
    bindEvents();
    renderAll();

    // Load shared ./fixture.json when served over HTTP
    if (typeof window.fetch === 'function') {
      fetch('./fixture.json')
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (json) {
          hydrateWithFixture(json);
        })
        .catch(function () {
          // Fallback fixture already active for local file:// preview
        });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
