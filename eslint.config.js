const eslint = require('@eslint/js');
const stylisticEslintPluginJs = require('@stylistic/eslint-plugin-js');
const globals = require('globals');

const customGlobals = {
	'browser': true,
	'expect': true,
	'$': true,
	'$$': true
};

module.exports = [
	eslint.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: {
				...globals.es2015,
				...globals.node,
				...globals.mocha,
				...customGlobals
			}
		}
	},
	{
		plugins: {
			'@stylistic/js': stylisticEslintPluginJs
		},
		rules: {
			'no-console': 0,
			'no-control-regex': 0,
			'no-debugger': 1,
			'no-empty': 0,
			'no-negated-in-lhs': 2,
			'no-regex-spaces': 0,
			'no-unexpected-multiline': 0,
			'block-scoped-var': 1,
			'eqeqeq': [1, 'smart'],
			'no-caller': 2,
			'no-div-regex': 1,
			'no-eval': 1,
			'no-extra-bind': 1,
			'no-implied-eval': 1,
			'no-iterator': 2,
			'no-labels': 2,
			'no-native-reassign': 2,
			'no-new-func': 2,
			'no-new-wrappers': 2,
			'no-new': 1,
			'no-octal-escape': 1,
			'no-proto': 2,
			'no-redeclare': [2, {'builtinGlobals': true}],
			'no-return-assign': [2, 'except-parens'],
			'no-self-compare': 2,
			'no-sequences': 2,
			'no-throw-literal': 2,
			'no-unused-expressions': [1, {'allowShortCircuit': true, 'allowTernary': true}],
			'no-useless-call': 2,
			'no-useless-return': 1,
			'no-with': 2,
			'radix': [1, 'as-needed'],
			'no-catch-shadow': 2,
			'no-label-var': 2,
			'no-shadow-restricted-names': 2,
			'no-shadow': [2, {'builtinGlobals': true, 'hoist': 'all', 'allow': ['context']}],
			'no-use-before-define': [2, {'functions': false}],
			'new-cap': [2, {'newIsCap': true, 'capIsNew': false}],
			'no-array-constructor': 2,
			'no-lonely-if': 1,
			'no-mixed-spaces-and-tabs': 1,
			'no-new-object': 1,
			'no-unneeded-ternary': 1,
			'require-yield': 0,

			// @stylistic/js plugin https://github.com/eslint-stylistic/eslint-stylistic
			'@stylistic/js/array-bracket-spacing': 1,
			'@stylistic/js/arrow-spacing': 1,
			'@stylistic/js/brace-style': [1, '1tbs', {'allowSingleLine': true}],
			'@stylistic/js/comma-dangle': 2,
			'@stylistic/js/comma-spacing': 1,
			'@stylistic/js/comma-style': 1,
			'@stylistic/js/computed-property-spacing': 1,
			'@stylistic/js/dot-location': [1, 'property'],
			'@stylistic/js/eol-last': 1,
			'@stylistic/js/func-call-spacing': 1,
			'@stylistic/js/indent': [1, 'tab', {'SwitchCase': 1}],
			'@stylistic/js/jsx-quotes': 1,
			'@stylistic/js/linebreak-style': 1,
			'@stylistic/js/new-parens': 1,
			'@stylistic/js/no-floating-decimal': 1,
			'@stylistic/js/no-trailing-spaces': 1,
			'@stylistic/js/operator-linebreak': [1, 'after'],
			'@stylistic/js/quotes': [1, 'single', {'avoidEscape':true}],
			'@stylistic/js/semi': [1, 'always'],
			'@stylistic/js/space-before-function-paren': [1, 'always'],
			'@stylistic/js/space-infix-ops': 0,
			'@stylistic/js/space-unary-ops': [1, {'words': true, 'nonwords': false}],
			'@stylistic/js/spaced-comment': [1, 'always', {'markers': ['*']}],
			'@stylistic/js/wrap-iife': [2, 'inside']
		}
	}
];
