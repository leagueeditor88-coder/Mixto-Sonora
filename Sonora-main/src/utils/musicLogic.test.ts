import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanMusicQuery, enrichGenreProfile, calculateConfidence, resolveGenreClassification } from './musicLogic.js';

test('cleanMusicQuery handles the exact user example with prompt text', () => {
  const result = cleanMusicQuery(' j Balvin - azul determinar genero');
  assert.equal(result.detectedArtist?.toLowerCase(), 'j balvin');
  assert.equal(result.detectedTitle?.toLowerCase(), 'azul');
  assert.equal(result.cleaned.toLowerCase(), 'j balvin - azul');
});

test('cleanMusicQuery cleans noise words like que genero es and cancion', () => {
  const result = cleanMusicQuery('qué género es la canción Queen - Bohemian Rhapsody');
  assert.equal(result.detectedArtist?.toLowerCase(), 'queen');
  assert.equal(result.detectedTitle?.toLowerCase(), 'bohemian rhapsody');
});

test('cleanMusicQuery handles "Azul de J Balvin"', () => {
  const result = cleanMusicQuery('Azul de J Balvin determinar genero');
  assert.equal(result.detectedTitle?.toLowerCase(), 'azul');
  assert.equal(result.detectedArtist?.toLowerCase(), 'j balvin');
});

test('cleanMusicQuery handles single title query gracefully', () => {
  const result = cleanMusicQuery('Despacito');
  assert.equal(result.cleaned, 'Despacito');
});

test('enrichGenreProfile separates Bachata from lazy Tropical/Latino umbrella label', () => {
  const profile = enrichGenreProfile('Tropical', ['latin', 'tropical'], 'romeo santos propuesta indecente');
  assert.match(profile.primaryGenre, /Bachata/);
  assert.equal(profile.isLazyLabelRefined, true);
  assert.match(profile.instruments.join(' '), /Requinto/);
});

test('enrichGenreProfile separates Salsa from lazy Tropical label', () => {
  const profile = enrichGenreProfile('Tropical', ['tropical'], 'hector lavoe periodico de ayer');
  assert.match(profile.primaryGenre, /Salsa/);
  assert.match(profile.typicalRhythm, /clave/i);
});

test('enrichGenreProfile classifies Corridos Tumbados instead of generic Latino', () => {
  const profile = enrichGenreProfile('Latino', ['musica mexicana'], 'peso pluma ella baila sola');
  assert.match(profile.primaryGenre, /Corridos Tumbados/);
  assert.match(profile.instruments.join(' '), /Docerola/);
});

test('enrichGenreProfile uses explicit Rock evidence instead of an artist-based guess', () => {
  const profile = enrichGenreProfile('Latino', ['rock'], 'de musica ligera');
  assert.equal(profile.primaryGenre, 'Rock');
});

test('enrichGenreProfile classifies Cumbia accurately', () => {
  const profile = enrichGenreProfile('Tropical', ['latin'], 'angeles azules 17 anos');
  assert.match(profile.primaryGenre, /Cumbia/);
  assert.match(profile.typicalRhythm, /güiro/i);
});

test('enrichGenreProfile detects Reggaetón for J Balvin Azul', () => {
  const profile = enrichGenreProfile('Latino', ['reggaeton', 'latin urban'], 'j balvin azul');
  assert.match(profile.primaryGenre, /Reggaetón/);
  assert.match(profile.typicalRhythm, /Dembow/);
});

test('calculateConfidence calculates score correctly', () => {
  const fullScore = calculateConfidence(true, true, true, true);
  assert.ok(fullScore >= 95);
});


test('cleanMusicQuery parses a quoted title before the artist and removes promotional descriptors', () => {
  const result = cleanMusicQuery('“Go Beyond (HONOR Brand Song)” — Andy Love');
  assert.equal(result.detectedTitle?.toLowerCase(), 'go beyond');
  assert.equal(result.detectedArtist?.toLowerCase(), 'andy love');
  assert.equal(result.cleaned, 'Andy Love - Go Beyond');
});

test('genre classification keeps Pop as the main family when Electropop is a supported subgenre', () => {
  const result = resolveGenreClassification('Pop', ['Electropop'], 'Electropop', ['Dance-pop']);
  assert.equal(result.primaryGenre, 'Pop');
  assert.ok(result.subgenres.some((genre) => /electropop/i.test(genre)));
});

test('conflicting AI genre does not blindly replace a catalog genre', () => {
  const result = resolveGenreClassification('Pop', [], 'Hip-Hop/Rap', ['Trap']);
  assert.equal(result.primaryGenre, 'Pop');
  assert.ok(!result.subgenres.includes('Trap'));
});


test('cleanMusicQuery recovers title and artist from a noisy promotional filename in mixed order', () => {
  const result = cleanMusicQuery('Go Beyond Andy (HONOR Brand .. 60 Andy Love');
  assert.equal(result.detectedTitle?.toLowerCase(), 'go beyond');
  assert.equal(result.detectedArtist?.toLowerCase(), 'andy love');
  assert.equal(result.cleaned, 'Andy Love - Go Beyond');
});

test('resolveGenreClassification does not promote a broad Latino label as a specific genre', () => {
  const result = resolveGenreClassification('Música Latina & Variada', [], undefined, []);
  assert.equal(result.primaryGenre, 'Desconocido');
});
