// Deliberately not an AI evaluator. Exercises the same child-process and output path.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { packetHash, kind } = JSON.parse(input);
const output =
  kind === 'artifact'
    ? {
        packetHash,
        artifact: {
          filename: 'demo.html',
          mediaType: 'text/html',
          content:
            '<!doctype html><html lang="en"><meta charset="utf-8"><title>TeamLoop fixture</title><body><h1>Runner fixture, not model output</h1><button onclick="this.textContent=\'Clicked\'">Try the fixture</button></body></html>',
        },
        rationale: 'Deterministic delivery fixture. No design quality claim.',
        uncertainties: ['Not produced or reviewed by a model.'],
      }
    : {
        packetHash,
        verdict: 'blocked',
        summary: 'The runner delivered this fixture successfully. A real review has not happened.',
        findings: [],
        uncertainties: ['No model was called. The lead must perform or commission a real review.'],
      };
console.log(JSON.stringify(output));
