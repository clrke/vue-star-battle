/**
 * Public-domain tunes for melody videos: each star the solver places plays the next note.
 * Pitches are semitones above the tonic (major keys only, so the solve still lands on I);
 * rhythm is dropped — every note is an even 8th, which keeps all of these recognisable.
 */
export interface Melody { id: string; title: string; notes: number[] }

export const MELODIES: Melody[] = [
  { id: 'ode-to-joy', title: 'Ode to Joy', notes: [4, 4, 5, 7, 7, 5, 4, 2, 0, 0, 2, 4, 4, 2, 2, 4, 4, 5, 7, 7, 5, 4, 2, 0, 0, 2, 4, 2, 0, 0] },
  { id: 'twinkle', title: 'Twinkle Twinkle Little Star', notes: [0, 0, 7, 7, 9, 9, 7, 5, 5, 4, 4, 2, 2, 0, 7, 7, 5, 5, 4, 4, 2, 7, 7, 5, 5, 4, 4, 2] },
  { id: 'jingle-bells', title: 'Jingle Bells', notes: [4, 4, 4, 4, 4, 4, 4, 7, 0, 2, 4, 5, 5, 5, 5, 5, 4, 4, 4, 4, 2, 2, 4, 2, 7, 4, 4, 4, 4, 4, 4, 4, 7, 0, 2, 4, 5, 5, 5, 5, 5, 4, 4, 4, 7, 7, 5, 2, 0] },
  { id: 'frere-jacques', title: 'Frère Jacques', notes: [0, 2, 4, 0, 0, 2, 4, 0, 4, 5, 7, 4, 5, 7, 7, 9, 7, 5, 4, 0, 7, 9, 7, 5, 4, 0, 0, -5, 0, 0, -5, 0] },
  { id: 'mary-lamb', title: 'Mary Had a Little Lamb', notes: [4, 2, 0, 2, 4, 4, 4, 2, 2, 2, 4, 7, 7, 4, 2, 0, 2, 4, 4, 4, 4, 2, 2, 4, 2, 0] },
]
