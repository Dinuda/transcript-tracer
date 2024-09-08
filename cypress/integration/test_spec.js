describe('Transcript Tracer Integration Test', () => {
    it('Loads the transcript and plays the audio', () => {
        cy.visit('test.html');
        cy.get('.tt-transcript').should('exist');
        cy.get('audio').should('exist');
    });
});
